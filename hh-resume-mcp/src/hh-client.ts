import { readFile } from "node:fs/promises";

type Tokens = { access_token: string; expires_at?: number };

export async function hhGet<T>(path: string): Promise<T> {
  const file = process.env.HH_TOKEN_FILE ?? ".tokens.json";
  let tokens: Tokens;
  try {
    tokens = JSON.parse(await readFile(file, "utf8")) as Tokens;
  } catch {
    throw new Error("Токен HH не найден. Сначала выполни npm run auth.");
  }
  if (tokens.expires_at && tokens.expires_at <= Date.now()) {
    throw new Error("Токен истёк. Нужно повторить OAuth авторизацию.");
  }
  const response = await fetch("https://api.hh.ru" + path, {
    headers: {
      Authorization: "Bearer " + tokens.access_token,
      "User-Agent": process.env.HH_USER_AGENT ?? "HH-Resume-MCP/0.1",
      Accept: "application/json"
    }
  });
  if (!response.ok) throw new Error("HH API error " + response.status + ": " + (await response.text()).slice(0, 1000));
  return await response.json() as T;
}
