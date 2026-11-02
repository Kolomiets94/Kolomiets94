import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const sources = ["HH.ru", "Хабр Карьера", "GeekJob", "Getmatch", "Telegram", "Company site", "SuperJob", "Работа России", "LinkedIn"] as const;
const vacancySchema = z.object({
  title: z.string().min(2).max(300),
  company: z.string().max(300).optional().default(""),
  url: z.string().url(),
  source: z.enum(sources),
  location: z.string().max(200).optional().default(""),
  remote: z.boolean().optional().default(false),
  employment: z.string().max(100).optional().default(""),
  salary_from: z.number().nonnegative().nullable().optional(),
  salary_to: z.number().nonnegative().nullable().optional(),
  currency: z.string().max(10).optional().default("RUB"),
  description: z.string().max(12000).optional().default(""),
  published_at: z.string().max(80).optional().default(""),
  found_at: z.string().optional(),
  contact_name: z.string().max(200).optional().default(""),
  contact_public_url: z.string().url().optional().or(z.literal("")),
  tags: z.array(z.string().max(80)).max(30).optional().default([])
});

type Vacancy = z.infer<typeof vacancySchema> & {
  id: string;
  found_at: string;
  updated_at: string;
  score: number;
  status: "new" | "seen" | "applied" | "rejected" | "archived";
};

const dataDir = join(process.cwd(), ".career-data");
const dataFile = join(dataDir, "vacancies.json");

async function readStore(): Promise<Vacancy[]> {
  try {
    const raw = await readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as Vacancy[] : [];
  } catch {
    return [];
  }
}

async function writeStore(rows: Vacancy[]) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, JSON.stringify(rows, null, 2), "utf8");
}

function canonicalUrl(value: string) {
  try {
    const u = new URL(value);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|yclid|gclid|from|hhtmfrom)/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

function fingerprint(v: Pick<Vacancy, "url" | "title" | "company">) {
  const byUrl = canonicalUrl(v.url).toLowerCase();
  return byUrl || [v.title, v.company].join("|").toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreVacancy(v: z.infer<typeof vacancySchema>) {
  const text = [v.title, v.description, ...(v.tags ?? [])].join(" ").toLowerCase();
  let score = 0;
  if (/frontend|front-end|фронтенд|верстальщик|html.?css/.test(text)) score += 25;
  if (/react/.test(text)) score += 18;
  if (/typescript|javascript/.test(text)) score += 10;
  if (/junior|джун|начинающ|без опыта|1 год|до 1 года/.test(text)) score += 12;
  if (/middle|мидл/.test(text)) score += 4;
  if (v.remote) score += 12;
  if (/екатеринбург/i.test(v.location)) score += 10;
  if (v.salary_from != null && v.salary_from >= 60000) score += 5;
  if (v.salary_to != null && v.salary_to >= 80000) score += 5;
  if (/senior|lead|руководитель|3\+ лет|4\+ лет|5\+ лет/.test(text)) score -= 25;
  if (/qa engineer|тестировщик|поддержк|оператор|менеджер продаж/.test(text)) score -= 50;
  return score;
}

export function registerVacancyStoreTools(server: McpServer) {
  server.tool(
    "career_import_vacancies",
    "Импортировать найденные публичные вакансии из HH, Хабр Карьеры, GeekJob, Getmatch, Telegram и карьерных страниц в локальную базу. Дедупликация по URL, источник и дата сохраняются. Ничего не откликается и не отправляет.",
    { vacancies: z.array(vacancySchema).min(1).max(100) },
    async ({ vacancies }) => {
      const rows = await readStore();
      const index = new Map(rows.map((v, i) => [fingerprint(v), i]));
      let inserted = 0;
      let updated = 0;
      for (const raw of vacancies) {
        const parsed = vacancySchema.parse(raw);
        const now = new Date().toISOString();
        const key = fingerprint(parsed);
        const existing = index.get(key);
        if (existing !== undefined) {
          rows[existing] = {
            ...rows[existing],
            ...parsed,
            id: rows[existing].id,
            found_at: rows[existing].found_at,
            updated_at: now,
            score: scoreVacancy(parsed)
          };
          updated++;
        } else {
          const row: Vacancy = {
            ...parsed,
            id: `v_${Date.now().toString(36)}_${(rows.length + 1).toString(36)}`,
            found_at: parsed.found_at || now,
            updated_at: now,
            score: scoreVacancy(parsed),
            status: "new"
          };
          rows.push(row);
          index.set(key, rows.length - 1);
          inserted++;
        }
      }
      await writeStore(rows);
      return { content: [{ type: "text", text: `Импорт завершён. Новых: ${inserted}; обновлено совпадающих: ${updated}; всего в локальной базе: ${rows.length}. Данные сохранены в .career-data/vacancies.json.` }] };
    }
  );

  server.tool(
    "career_list_vacancies",
    "Получить вакансии из локальной базы с фильтрами по ключевым словам, статусу, формату, региону и минимальной зарплате. Сначала новые и наиболее релевантные.",
    {
      query: z.string().max(200).optional().default(""),
      location: z.string().max(200).optional().default(""),
      remote_only: z.boolean().optional().default(false),
      min_salary: z.number().nonnegative().optional().default(0),
      status: z.enum(["all", "new", "seen", "applied", "rejected", "archived"]).optional().default("all"),
      exclude_irrelevant: z.boolean().optional().default(true),
      limit: z.number().int().min(1).max(100).optional().default(30)
    },
    async ({ query, location, remote_only, min_salary, status, exclude_irrelevant, limit }) => {
      const rows = await readStore();
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const filtered = rows.filter(v => {
        const haystack = [v.title, v.company, v.description, ...v.tags].join(" ").toLowerCase();
        if (terms.length && !terms.some(t => haystack.includes(t))) return false;
        if (location && !v.location.toLowerCase().includes(location.toLowerCase())) return false;
        if (remote_only && !v.remote) return false;
        if (min_salary && (v.salary_to ?? v.salary_from ?? 0) < min_salary) return false;
        if (status !== "all" && v.status !== status) return false;
        if (exclude_irrelevant && /(^|\b)(qa|quality assurance|support engineer|customer support|оператор|тестировщик|специалист поддержки|техническая поддержка|менеджер продаж)(\b|$)/i.test(v.title)) return false;
        return true;
      }).sort((a, b) => b.score - a.score || b.found_at.localeCompare(a.found_at)).slice(0, limit);
      const output = filtered.map(v => [
        `[${v.status}] ${v.title} — ${v.company || "компания не указана"} (score ${v.score})`,
        `Источник: ${v.source}; локация: ${v.location || "не указана"}; удалённо: ${v.remote ? "да" : "нет"}`,
        `Зарплата: ${v.salary_from ?? "?"}–${v.salary_to ?? "?"} ${v.currency}`,
        `Опубликована: ${v.published_at || "не указана"}; добавлена: ${v.found_at}`,
        v.url
      ].join("\n"));
      return { content: [{ type: "text", text: `В базе: ${rows.length}; по фильтрам: ${filtered.length}.\n\n${output.length ? output.join("\n\n---\n\n") : "Подходящих записей пока нет."}` }] };
    }
  );
}
