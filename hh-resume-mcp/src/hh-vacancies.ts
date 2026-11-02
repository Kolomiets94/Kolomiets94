import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerHhVacancyTools(server: McpServer) {
  server.tool(
    "career_search_hh_vacancies",
    "Сформировать ссылку на поиск вакансий HH.ru с фильтрами. Не вызывает закрытый API, не пытается обходить CAPTCHA и не собирает данные автоматически.",
    {
      text: z.string().min(2).max(200).default("Frontend React TypeScript"),
      area: z.string().default(" Екатеринбург").describe("Регион текстом, например Екатеринбург или Россия."),
      remote_only: z.boolean().default(false),
      min_salary: z.number().int().nonnegative().optional()
    },
    async ({ text, area, remote_only, min_salary }) => {
      const params = new URLSearchParams({ text, area: area.trim() });
      if (remote_only) params.set("work_format", "REMOTE");
      if (min_salary) params.set("salary", String(min_salary));
      const url = `https://hh.ru/search/vacancy?${params.toString()}`;
      return {
        content: [{
          type: "text",
          text: [
            "Автоматический неавторизованный поиск через API HH.ru отключён: документация HH указывает на CAPTCHA для запросов без OAuth, а с апреля 2026 сообщалось о 403 для публичной выдачи.",
            "Поэтому этот инструмент только формирует корректную ссылку на веб-поиск HH; он не извлекает список вакансий и не обходит защиту.",
            `Запрос: ${text}; регион: ${area}; удалённо: ${remote_only ? "да" : "нет"}; минимальная зарплата: ${min_salary ?? "не задана"}.`,
            url,
            "Откройте страницу вручную либо используйте разрешённый экспорт/уведомления HH. После этого результаты можно импортировать через career_import_vacancies."
          ].join("\n")
        }]
      };
    }
  );
}
