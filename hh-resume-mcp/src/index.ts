import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerHhVacancyTools } from "./hh-vacancies.js";
import { registerVacancyStoreTools } from "./vacancy-store.js";
import { registerPublicSourceTools } from "./public-sources.js";
import { registerGeekjobGetmatchTools } from "./geekjob-getmatch.js";

const server = new McpServer({ name: "hh-resume-mcp", version: "0.3.0" });

registerHhVacancyTools(server);
registerVacancyStoreTools(server);
registerPublicSourceTools(server);
registerGeekjobGetmatchTools(server);

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



server.tool(
  "career_recruiter_search_brief",
  "Сформировать план поиска публичных профессиональных контактов рекрутеров и HR по заданной вакансии. Это исследовательское задание для ИИ-клиента, а не встроенный веб-поиск.",
  {
    target_role: z.string().min(2).max(200).default("Frontend Developer (React, TypeScript)"),
    location: z.string().min(2).max(200).default("Екатеринбург или удалённо по России"),
    skills: z.array(z.string().min(1).max(80)).max(30).default(["React", "TypeScript", "JavaScript"]),
    vacancy_url: z.string().url().optional(),
    company_names: z.array(z.string().min(1).max(160)).max(30).default([]),
    sources: z.array(z.enum(["LinkedIn", "Telegram", "Хабр Карьера", "Getmatch", "карьерные страницы компаний", "HH.ru", "GeekJob", "SuperJob", "Работа России"])).default(["LinkedIn", "Telegram", "Хабр Карьера", "Getmatch", "карьерные страницы компаний", "HH.ru", "GeekJob", "SuperJob", "Работа России"])
  },
  async ({ target_role, location, skills, vacancy_url, company_names, sources }) => ({
    content: [{
      type: "text",
      text: [
        "ЗАДАНИЕ ДЛЯ ПОИСКА ПУБЛИЧНЫХ ПРОФЕССИОНАЛЬНЫХ КОНТАКТОВ",
        "Роль: " + target_role,
        "Локация/формат: " + location,
        "Навыки: " + skills.join(", "),
        "Компании для приоритетной проверки: " + (company_names.length ? company_names.join(", ") : "найти компании с релевантными открытыми вакансиями"),
        "URL вакансии: " + (vacancy_url ?? "не указан"),
        "Источники: " + sources.join(", "),
        "",
        "Найди только публичные профессиональные сведения: имя, должность, компания, рабочий профиль или опубликованный рабочий email, ссылка на источник, связанная вакансия и дата проверки.",
        "Приоритетные должности: IT Recruiter, Technical Recruiter, Talent Acquisition, HR / специалист по подбору.",
        "Для Telegram используй только публичные каналы, публикации вакансий и контакты, которые автор сам указал для рабочих обращений.",
        "Не пытайся получить личные телефоны, личные email, закрытые данные, cookies или доступ к аккаунтам. Не обходи авторизацию, CAPTCHA, paywall или ограничения сайтов.",
        "Не угадывай адреса email. Если контакт не опубликован, укажи «не найден публично». Для каждого факта приложи URL-источник и отметь, что именно подтверждено.",
        "Отфильтруй контакты по наличию актуальной Frontend-вакансии React/TypeScript либо явной связи рекрутера с наймом frontend-разработчиков.",
        "Верни таблицу: контакт | роль | компания | релевантная вакансия | публичный способ связи | источник | дата проверки | уверенность.",
        "Ничего не отправляй и не инициируй коннекты."
      ].join("\n")
    }]
  })
);

server.tool(
  "career_prepare_recruiter_message",
  "Подготовить персональное сообщение рекрутеру на основе публичной контактной информации и конкретной вакансии. Ничего не отправляет.",
  {
    recruiter_name: z.string().max(160).optional(),
    recruiter_role: z.string().max(160).optional(),
    company: z.string().min(1).max(200),
    vacancy_title: z.string().min(2).max(200),
    vacancy_url: z.string().url().optional(),
    vacancy_requirements: z.string().max(12000).optional(),
    public_contact_context: z.string().max(4000).optional(),
    candidate_profile: z.string().min(30).max(12000),
    channel: z.enum(["LinkedIn", "Telegram", "email"]).default("LinkedIn")
  },
  async ({ recruiter_name, recruiter_role, company, vacancy_title, vacancy_url, vacancy_requirements, public_contact_context, candidate_profile, channel }) => ({
    content: [{
      type: "text",
      text: [
        "ПОДГОТОВЬ ЧЕРНОВИК ПЕРСОНАЛЬНОГО ОБРАЩЕНИЯ — НЕ ОТПРАВЛЯЙ ЕГО",
        "Канал: " + channel,
        "Обращение: " + (recruiter_name ?? "без имени"),
        "Роль контакта: " + (recruiter_role ?? "не указана"),
        "Компания: " + company,
        "Вакансия: " + vacancy_title,
        "Ссылка: " + (vacancy_url ?? "не указана"),
        "Требования вакансии: " + (vacancy_requirements ?? "не предоставлены"),
        "Публичный контекст контакта: " + (public_contact_context ?? "не предоставлен"),
        "",
        "Профиль кандидата:",
        candidate_profile,
        "",
        "Составь короткое, естественное и конкретное сообщение. Укажи, почему обращение адресовано именно этому рекрутеру и чем опыт кандидата соответствует вакансии. Не выдумывай коммерческий опыт, метрики, навыки, имя или знакомство. Не называй английский свободным, если уровень не указан. Не делай массовую рассылку и не дави на адресата.",
        "Верни также 2 варианта темы/первой строки и короткое объяснение персонализации. Любая отправка требует отдельного явного подтверждения пользователя."
      ].join("\n")
    }]
  })
);
await server.connect(new StdioServerTransport());
