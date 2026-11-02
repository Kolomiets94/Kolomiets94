import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { importVacancies } from "./vacancy-store.js";

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

async function fetchPublic(url: string, accept = "text/html,application/xhtml+xml") {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
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
      headers: { "User-Agent": UA, Accept: accept },
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
type GetmatchOffer = {
  id: number;
  position: string;
  url: string;
  is_active?: boolean;
  offer_description?: string | null;
  description?: string | null;
  company?: { name?: string } | null;
  salary_display_from?: number | null;
  salary_display_to?: number | null;
  salary_currency?: string | null;
  salary_description?: string | null;
  location_items?: { label?: string; format?: string; exclude?: boolean }[];
  location_requirements?: { city?: string; country?: string; exclude?: boolean }[];
  stack?: string[];
  specializations?: string[];
  skills_objects?: { name?: string }[];
};

function getmatchSalary(offer: GetmatchOffer) {
  const from = offer.salary_display_from;
  const to = offer.salary_display_to;
  const currency = offer.salary_currency === "USD" ? "$" : offer.salary_currency === "EUR" ? "€" : "₽";
  const fmt = (n: number) => n.toLocaleString("ru-RU");
  if (from != null && to != null) return `${fmt(from)}–${fmt(to)} ${currency}`;
  if (from != null) return `от ${fmt(from)} ${currency}`;
  if (to != null) return `до ${fmt(to)} ${currency}`;
  return offer.salary_description || "";
}

async function enrichGetmatchOffers(offers: GetmatchOffer[], limit = 8): Promise<GetmatchOffer[]> {
  return Promise.all(offers.map(async (offer, index) => {
    if (index >= limit || !offer.id) return offer;
    try {
      const detail = JSON.parse(await fetchPublic(`https://getmatch.ru/api/offers/${offer.id}`, "application/json")) as GetmatchOffer;
      return { ...offer, ...detail };
    } catch {
      return offer;
    }
  }));
}

function getmatchCard(offer: GetmatchOffer): Card {
  const locations = (offer.location_items ?? []).filter(item => !item.exclude);
  const requirements = (offer.location_requirements ?? []).filter(item => !item.exclude);
  const remote = locations.some(item => item.format?.toLowerCase() === "remote");
  const location = [
    ...locations.map(item => item.label || ""),
    ...requirements.map(item => item.city || item.country || "")
  ].filter(Boolean).join(", ");
  const stack = (offer.stack ?? []).join(", ");
  const skills = (offer.skills_objects ?? []).map(item => item.name || "").filter(Boolean).join(", ");
  const context = [offer.offer_description || "", offer.description || "", stack, skills, ...(offer.specializations ?? [])]
    .filter(Boolean).join("\n").slice(0, 12000);
  return {
    title: offer.position || "Вакансия Getmatch",
    url: new URL(offer.url, "https://getmatch.ru").toString(),
    company: offer.company?.name || "",
    salary: getmatchSalary(offer),
    location,
    remote,
    context
  };
}


function toVacancy(card: Card, source: "GeekJob" | "Getmatch") {
  const rub = card.salary.match(/(\d[\d\s]{2,})(?:\s*[—–-]\s*(\d[\d\s]{2,}))?\s*(?:₽|руб(?:лей)?|RUB|\$|USD|€|EUR)/i);
  const amount = (v?: string) => v ? Number(v.replace(/\s/g, "")) : undefined;
  return {
    title: card.title.slice(0, 300), company: card.company.slice(0, 300), url: card.url, source,
    location: card.location.slice(0, 200), remote: card.remote,
    salary_from: amount(rub?.[1]) ?? null, salary_to: amount(rub?.[2]) ?? amount(rub?.[1]) ?? null,
    currency: /\$|USD/i.test(card.salary) ? "USD" : /€|EUR/i.test(card.salary) ? "EUR" : "RUB", description: decode(card.context).slice(0, 12000),
    tags: [source.toLowerCase(), ...["frontend", "react", "typescript", "javascript"].filter(tag => `${card.title} ${card.context}`.toLowerCase().includes(tag))]
  };
}

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
    const resolved = new URL(a.href, host);
    if (resolved.protocol !== "https:" || resolved.hostname !== new URL(host).hostname) continue;
    const url = resolved.toString();
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

async function enrichCards(cards: Card[], limit = 8): Promise<Card[]> {
  return Promise.all(cards.map(async (card, index) => {
    if (index >= limit) return card;
    try {
      const html = await fetchPublic(card.url);
      const description = (html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)/i) || [])[1] ?? "";
      const main = (html.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i) || [])[1] ?? html;
      const detail = decode(main).slice(0, 6500);
      const combined = [description ? `Описание: ${decode(description)}` : "", detail]
        .filter(Boolean).join("\n").slice(0, 12000);
      return { ...card, context: combined || card.context };
    } catch {
      return card;
    }
  }));
}

function formatCards(cards: Card[]) {
  return cards.map(card =>
    `**${card.title}**\nКомпания: ${card.company || "не извлечена"}\nЗарплата: ${card.salary || "не извлечена"}\nЛокация: ${card.location || "не извлечена"}\nУдалённо: ${card.remote ? "да" : "не подтверждено"}\nСсылка: ${card.url}\nТекст карточки: ${card.context}`
  ).join("\n\n---\n\n");
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
      url.searchParams.set("page", String(page));
      try {
        const html = await fetchPublic(url.toString());
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const cards = parseCards(html, "https://gkjb.ru", /\/vacancy\/[a-z0-9-]+/i)
          .filter(card => terms.some(term => `${card.title} ${card.context}`.toLowerCase().includes(term)));
        const enriched = cards.length ? await enrichCards(cards) : [];
        const imported = enriched.length ? await importVacancies(enriched.map(card => toVacancy(card, "GeekJob"))) : "Импорт не выполнялся: карточки не найдены.";
        const text = enriched.length
          ? formatCards(enriched)
          : "Карточки не распознаны. Возможно, сайт изменил HTML или выдача требует другого параметра.";
        return { content: [{ type: "text", text: `Geekjob — ${cards.length} карточек-кандидатов\nСтраница: ${url}\n${imported}\n\n${text}\n\nПроверьте грейд, занятость, зарплату и дату на странице вакансии перед импортом.` }] };
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
      const url = new URL("https://getmatch.ru/api/offers");
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      try {
        const allOffers: GetmatchOffer[] = [];
        let total = 0;
        for (let offset = 0; offset < 500; offset += 100) {
          url.searchParams.set("offset", String(offset));
          url.searchParams.set("limit", "100");
          const payload = JSON.parse(await fetchPublic(url.toString(), "application/json")) as { meta?: { total?: number }; offers?: GetmatchOffer[] };
          const pageOffers = payload.offers ?? [];
          allOffers.push(...pageOffers);
          total = payload.meta?.total ?? total;
          if (!pageOffers.length || pageOffers.length < 100 || (total > 0 && offset + pageOffers.length >= total)) break;
        }
        const candidates = allOffers
          .filter(offer => offer.is_active !== false)
          .filter(offer => {
            const searchable = [offer.position, offer.offer_description, offer.description, ...(offer.stack ?? []), ...(offer.specializations ?? [])].join(" ").toLowerCase();
            return terms.some(term => searchable.includes(term));
          })
          .filter(offer => !remote_only || (offer.location_items ?? []).some(item => item.format?.toLowerCase() === "remote" && !item.exclude));
        const enrichedOffers = await enrichGetmatchOffers(candidates);
        const cards = enrichedOffers.map(getmatchCard);
        const imported = cards.length ? await importVacancies(cards.map(card => toVacancy(card, "Getmatch"))) : "Импорт не выполнялся: API не вернул активные совпадающие вакансии.";
        const text = cards.length
          ? formatCards(cards)
          : "API не вернул вакансии по заданным словам и фильтрам. Проверьте каталог вручную.";
        return { content: [{ type: "text", text: `Getmatch API — ${cards.length} карточек-кандидатов\nИсточник: ${url}\n${imported}\n\n${text}\n\nВажно: сервис ориентирован преимущественно на middle+; junior-позиции встречаются реже. Проверяйте грейд и актуальность вакансии.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Не удалось прочитать Getmatch: ${String(e)}\n${url}` }], isError: true };
      }
    }
  );
}
