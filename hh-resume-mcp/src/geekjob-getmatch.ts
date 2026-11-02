import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const UA = "CareerMCP/0.4 (public vacancy index; low-volume read-only)";
const decode = (s: string) => s
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/\s+/g, " ").trim();

async function fetchPublic(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(20000),
    redirect: "manual"
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error(`HTTP ${response.status} without Location`);
    const next = new URL(location, url);
    if (next.protocol !== "https:" || next.hostname !== new URL(url).hostname) {
      throw new Error("Refused cross-host or non-HTTPS redirect");
    }
    const second = await fetch(next, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(20000),
      redirect: "error"
    });
    if (!second.ok) throw new Error(`HTTP ${second.status}`);
    return await second.text();
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

type Card = { title: string; url: string; company: string; salary: string; location: string; remote: boolean; context: string };

function parseCards(html: string, host: string, pathPattern: RegExp): Card[] {
  const anchors: { href: string; title: string; start: number; end: number }[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!pathPattern.test(href)) continue;
    const title = decode(m[2]);
    if (title.length < 4 || title.length > 180) continue;
    anchors.push({ href, title, start: m.index, end: re.lastIndex });
  }
  const out = new Map<string, Card>();
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const url = new URL(a.href, host).toString();
    const block = html.slice(a.end, anchors[i + 1]?.start ?? Math.min(html.length, a.end + 7000));
    const context = decode(block).slice(0, 5000);
    const salary = (context.match(/(?:от\s*)?\d[\d\s]{2,}(?:\s*[—–-]\s*\d[\d\s]{2,})?\s*(?:₽|руб(?:лей)?|RUB|\$|USD|€)/i) || [])[0] ?? "";
    const location = (context.match(/(?:Екатеринбург|Москва|Санкт-Петербург|Россия|Минск|Казахстан|remote|удал[её]нно|Дубай|Лимассол)/i) || [])[0] ?? "";
    const company = (context.match(/(?:компания|работодатель)\s*:?\s*([^|,;]{2,100})/i) || [])[1]?.trim() ?? "";
    const remote = /remote|удал[её]н/i.test(context);
    out.set(url, { title: a.title, url, company, salary, location, remote, context });
  }
  return [...out.values()];
}

export function registerGeekjobGetmatchTools(server: McpServer) {
  server.tool(
    "career_search_geekjob_vacancies",
    "Ищет вакансии в публичном каталоге Geekjob, извлекает ссылки-кандидаты и контекст карточек. Только read-only, без входа и откликов.",
    {
      query: z.string().min(2).max(100).default("Frontend React TypeScript"),
      page: z.number().int().min(1).max(20).default(1)
    },
    async ({ query, page }) => {
      const url = new URL("https://gkjb.ru/vacancies");
      url.searchParams.set("q", query);
      url.searchParams.set("page", String(page));
      try {
        const html = await fetchPublic(url.toString());
        const cards = parseCards(html, "https://gkjb.ru", /\/vacancy\/[a-z0-9-]+/i);
        const text = cards.length
          ? cards.map(c => `**${c.title}**\n${c.company ? `Компания: ${c.company}\n` : ""}${c.salary ? `Зарплата: ${c.salary}\n` : ""}${c.location ? `Локация: ${c.location}\n` : ""}Удалённо: ${c.remote ? "да" : "не подтверждено"}\n${c.url}\nКонтекст: ${c.context}`).join("\n\n---\n\n")
          : "Карточки не распознаны. Возможно, сайт изменил HTML или выдача требует другого параметра.";
        return { content: [{ type: "text", text: `Geekjob — ${cards.length} карточек-кандидатов\nСтраница: ${url}\n\n${text}\n\nПроверьте грейд, занятость, зарплату и дату на странице вакансии перед импортом.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Не удалось прочитать Geekjob: ${String(e)}\n${url}` }], isError: true };
      }
    }
  );

  server.tool(
    "career_search_getmatch_vacancies",
    "Ищет вакансии в публичном каталоге Getmatch. Каталог доступен без входа, но отклик требует работы через сервис. Сборщик только читает публичный HTML.",
    {
      query: z.string().min(2).max(100).default("Frontend React TypeScript"),
      remote_only: z.boolean().default(false)
    },
    async ({ query, remote_only }) => {
      const url = new URL("https://getmatch.ru/vacancies");
      url.searchParams.set("q", query);
      if (remote_only) url.searchParams.set("format", "remote");
      try {
        const html = await fetchPublic(url.toString());
        const cards = parseCards(html, "https://getmatch.ru", /\/vacancies\/[a-z0-9-]+/i)
          .filter(c => !remote_only || c.remote);
        const text = cards.length
          ? cards.map(c => `**${c.title}**\n${c.company ? `Компания: ${c.company}\n` : ""}${c.salary ? `Зарплата: ${c.salary}\n` : ""}${c.location ? `Локация: ${c.location}\n` : ""}Удалённо: ${c.remote ? "да" : "не подтверждено"}\n${c.url}\nКонтекст: ${c.context}`).join("\n\n---\n\n")
          : "Карточки не распознаны или нет совпадений. Проверьте каталог вручную.";
        return { content: [{ type: "text", text: `Getmatch — ${cards.length} карточек-кандидатов\nСтраница: ${url}\n\n${text}\n\nВажно: сервис ориентирован преимущественно на middle+; junior-позиции встречаются реже. Проверяйте грейд и актуальность вакансии.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Не удалось прочитать Getmatch: ${String(e)}\n${url}` }], isError: true };
      }
    }
  );
}
