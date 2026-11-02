import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const UA = "CareerMCP/0.3 (+public vacancy index; respectful low-volume requests)";
const clean = (s: string) => s
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/g, " ")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/\s+/g, " ").trim();

async function getHtml(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return await response.text();
}

function extractHabr(html: string) {
  const rows = new Map<string, { title: string; url: string; context: string }>();
  const re = /<a\b[^>]*href=["'](\/vacancies\/[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = new URL(m[1], "https://career.habr.com").toString();
    const title = clean(m[2]);
    if (!title || title.length < 4 || /^(вакансии|компании|откликнуться)$/i.test(title)) continue;
    const start = Math.max(0, m.index - 900);
    const context = clean(html.slice(start, Math.min(html.length, re.lastIndex + 1200))).slice(0, 900);
    rows.set(url, { title, url, context });
  }
  return [...rows.values()];
}

function extractTelegram(html: string, channel: string) {
  const rows: { title: string; url: string; context: string }[] = [];
  const re = /data-post=["']([^"']+\/\d+)["'][\s\S]*?class=["'][^"']*tgme_widget_message_text[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const post = m[1];
    const text = clean(m[2]).slice(0, 5000);
    if (!text) continue;
    const title = text.split(/(?<=[.!?])\s+/)[0].slice(0, 180) || `Публикация из @${channel}`;
    rows.push({ title, url: `https://t.me/${post}`, context: text });
  }
  return rows;
}

export function registerPublicSourceTools(server: McpServer) {
  server.tool(
    "career_search_habr_vacancies",
    "Прочитать публичную страницу выдачи Хабр Карьеры и вернуть найденные карточки вакансий. Не входит в аккаунт и не откликается.",
    {
      query: z.enum(["react_razrabotchik", "frontend_razrabotchik", "html_verstalshchik", "javascript_razrabotchik"]).default("react_razrabotchik"),
      remote_only: z.boolean().default(false),
      page: z.number().int().min(1).max(20).default(1)
    },
    async ({ query, remote_only, page }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (remote_only) params.set("remote", "true");
      const url = `https://career.habr.com/vacancies/${query}?${params}`;
      try {
        const html = await getHtml(url);
        const rows = extractHabr(html);
        const text = rows.length
          ? rows.map(v => `**${v.title}**\n${v.url}\nКонтекст карточки: ${v.context}`).join("\n\n---\n\n")
          : "Карточки вакансий не удалось извлечь из HTML. Откройте страницу вручную или повторите позже.";
        return { content: [{ type: "text", text: `Источник: Хабр Карьера\nСтраница: ${url}\nНайдено ссылок-кандидатов: ${rows.length}\n\n${text}\n\nЭто первичный сбор ссылок; проверьте требования, зарплату и актуальность на исходной странице перед импортом.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Не удалось прочитать публичную страницу Хабр Карьеры: ${String(e)}. Используйте ссылку вручную: ${url}` }], isError: true };
      }
    }
  );

  server.tool(
    "career_search_telegram_vacancies",
    "Прочитать публичную веб-ленту t.me/s/<channel> и извлечь сообщения с вакансиями. Не использует Telegram-аккаунт, не читает закрытые каналы и не отправляет сообщения.",
    {
      channels: z.array(z.string().regex(/^[a-zA-Z0-9_]{5,32}$/)).min(1).max(10)
        .default(["forfrontend", "frontend_rabota", "senior_frontender", "job_react"]),
      keywords: z.array(z.string().min(2).max(60)).max(20)
        .default(["frontend", "react", "typescript", "javascript", "верстальщик", "html", "css"]),
      max_posts_per_channel: z.number().int().min(1).max(30).default(15)
    },
    async ({ channels, keywords, max_posts_per_channel }) => {
      const output: string[] = [];
      const terms = keywords.map(k => k.toLowerCase());
      for (const channel of channels) {
        const url = `https://t.me/s/${channel}`;
        try {
          const html = await getHtml(url);
          const posts = extractTelegram(html, channel).slice(-max_posts_per_channel);
          const matched = posts.filter(p => terms.some(t => p.context.toLowerCase().includes(t)));
          output.push(`### @${channel} — ${matched.length} совпадений из ${posts.length} последних сообщений`);
          output.push(matched.map(p => `**${p.title}**\n${p.url}\n${p.context}`).join("\n\n---\n\n") || "Совпадений по ключевым словам не найдено.");
        } catch (e) {
          output.push(`### @${channel}\nНе удалось прочитать публичную ленту: ${String(e)}. Ссылка: ${url}`);
        }
      }
      return { content: [{ type: "text", text: output.join("\n\n") + "\n\nРезультаты — кандидаты на вакансии. Проверяйте срок публикации, работодателя и условия на исходном посте." }] };
    }
  );
}
