import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { hhGet } from "./hh-client.js";

type ResumeList = { items?: Array<Record<string, unknown>>; found?: number };
type Resume = Record<string, unknown>;

const server = new McpServer({ name: "hh-resume-mcp", version: "0.1.0" });

server.tool(
  "hh_get_profile",
  "Получить профиль текущего авторизованного соискателя HH. Только чтение.",
  {},
  async () => {
    const data = await hhGet<Resume>("/me");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "hh_list_my_resumes",
  "Получить список собственных резюме пользователя HH, включая идентификаторы, статусы и счётчики. Только чтение.",
  {},
  async () => {
    const data = await hhGet<ResumeList>("/resumes/mine");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "hh_get_resume",
  "Получить подробные данные одного собственного резюме по ID. Только чтение.",
  { resume_id: z.string().min(1).describe("ID резюме из hh_list_my_resumes") },
  async ({ resume_id }) => {
    const data = await hhGet<Resume>(`/resumes/${encodeURIComponent(resume_id)}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
