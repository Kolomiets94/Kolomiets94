import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type HhVacancy = {
  id: string;
  name: string;
  employer?: { name?: string };
  area?: { name?: string };
  salary?: { from?: number | null; to?: number | null; currency?: string; gross?: boolean | null } | null;
  experience?: { name?: string };
  employment?: { name?: string };
  schedule?: { name?: string };
  published_at?: string;
  alternate_url?: string;
  snippet?: { requirement?: string; responsibility?: string };
};

type HhSearchResponse = {
  found?: number;
  pages?: number;
  items?: HhVacancy[];
};

export function registerHhVacancyTools(server: McpServer) {
  server.tool(
    "career_search_hh_vacancies",
    "Ищет открытые вакансии через публичный read-only API HH.ru. Не требует входа, не использует аккаунт соискателя и ничего не отправляет.",
    {
      text: z.string().min(2).max(200).default("Frontend React TypeScript"),
      area: z.string().default("3").describe("Код региона HH; 3 — Екатеринбург. Для удалённого поиска можно передать пустую строку."),
      remote_only: z.boolean().default(false),
      per_page: z.number().int().min(1).max(50).default(20),
      page: z.number().int().min(0).max(19).default(0)
    },
    async ({ text, area, remote_only, per_page, page }) => {
      const params = new URLSearchParams({
        text,
        per_page: String(per_page),
        page: String(page),
        order_by: "publication_time"
      });
      if (area.trim()) params.set("area", area.trim());
      if (remote_only) params.set("schedule", "remote");

      const response = await fetch(`https://api.hh.ru/vacancies?${params.toString()}`, {
        headers: {
          "User-Agent": "CareerMCP/0.1 (read-only public vacancy search)",
          "Accept": "application/json"
        },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        return { content: [{ type: "text" as const, text: `HH API вернул HTTP ${response.status}. Попробуйте позже; авторизация не выполнялась.` }], isError: true };
      }

      const data = await response.json() as HhSearchResponse;
      const items = (data.items ?? []).map((v) => {
        const salary = v.salary
          ? [v.salary.from != null ? `от ${v.salary.from}` : "", v.salary.to != null ? `до ${v.salary.to}` : "", v.salary.currency ?? ""].filter(Boolean).join(" ")
          : "не указана";
        return [
          `**${v.name}** — ${v.employer?.name ?? "компания не указана"}`,
          `Регион: ${v.area?.name ?? "не указан"} | Опыт: ${v.experience?.name ?? "не указан"} | Занятость: ${v.employment?.name ?? "не указана"} | График: ${v.schedule?.name ?? "не указан"}`,
          `Зарплата: ${salary}`,
          v.snippet?.requirement ? `Требования: ${v.snippet.requirement.replace(/<[^>]*>/g, "")}` : "",
          v.snippet?.responsibility ? `Задачи: ${v.snippet.responsibility.replace(/<[^>]*>/g, "")}` : "",
          `Опубликована: ${v.published_at ?? "дата не указана"}`,
          v.alternate_url ?? `https://hh.ru/vacancy/${v.id}`
        ].filter(Boolean).join("\n");
      });

      return {
        content: [{
          type: "text",
          text: [
            `HH.ru: найдено ${data.found ?? 0} вакансий; страница ${page + 1} из ${data.pages ?? 1}.`,
            `Запрос: ${text}; регион HH: ${area || "не ограничен"}; только удалённые: ${remote_only ? "да" : "нет"}.`,
            "",
            items.length ? items.join("\n\n---\n\n") : "По этому запросу вакансии не найдены.",
            "",
            "Источник: публичный API HH.ru. Результаты — объявления, доступные на момент запроса; перед откликом проверьте актуальность и условия на странице вакансии."
          ].join("\n")
        }]
      };
    }
  );
}
