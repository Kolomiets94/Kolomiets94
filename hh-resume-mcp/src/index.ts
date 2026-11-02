import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "hh-resume-mcp", version: "0.2.0" });

server.tool(
  "hh_prepare_resume_review",
  "Подготовить текст собственного резюме HH к анализу. Вставьте текст, экспортированный из HH (например, из PDF). Инструмент не подключается к аккаунту HH и не изменяет резюме.",
  {
    resume_text: z.string().min(100).max(50000).describe("Текст резюме, экспортированный пользователем из HH"),
    target_role: z.string().default("Junior Frontend Developer (React, TypeScript)").describe("Целевая должность")
  },
  async ({ resume_text, target_role }) => {
    const brief = [
      "РЕЗЮМЕ ДЛЯ ПРОВЕРКИ",
      "Целевая роль: " + target_role,
      "",
      "Проведи аудит текста ниже и верни:",
      "1. Краткую оценку соответствия целевой роли.",
      "2. Конкретные причины, по которым рекрутер может отказать или не заметить профиль.",
      "3. Проблемы заголовка, специализации, навыков, опыта и описания проектов.",
      "4. Исправленную версию каждого слабого фрагмента без выдумывания коммерческого опыта, навыков, цифр и достижений.",
      "5. Список изменений, которые пользователь должен вручную внести на HH.",
      "Учитывай, что учебные и личные проекты нельзя представлять как коммерческую работу.",
      "Не добавляй неуказанные факты. Если данных не хватает, обозначь это явно.",
      "",
      "ИСХОДНЫЙ ТЕКСТ РЕЗЮМЕ",
      resume_text
    ].join("\n");
    return { content: [{ type: "text", text: brief }] };
  }
);

server.tool(
  "hh_compare_resume_versions",
  "Сравнить две версии резюме и выявить, какие изменения улучшили или ухудшили ясность и соответствие целевой роли.",
  {
    old_version: z.string().min(100).max(50000),
    new_version: z.string().min(100).max(50000),
    target_role: z.string().default("Junior Frontend Developer (React, TypeScript)")
  },
  async ({ old_version, new_version, target_role }) => ({
    content: [{
      type: "text",
      text: [
        "Сравни две версии резюме для роли: " + target_role,
        "Покажи изменения по разделам, улучшения, регрессии, потерянные факты и возможные новые неподтверждённые утверждения.",
        "Не считай формулировку улучшением, если она преувеличивает опыт или навыки.",
        "",
        "СТАРАЯ ВЕРСИЯ",
        old_version,
        "",
        "НОВАЯ ВЕРСИЯ",
        new_version
      ].join("\n")
    }]
  })
);

await server.connect(new StdioServerTransport());
