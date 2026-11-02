import "dotenv/config";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const clientId = process.env.HH_CLIENT_ID;
const clientSecret = process.env.HH_CLIENT_SECRET;
const redirectUri = process.env.HH_REDIRECT_URI ?? "http://localhost:8765/callback";
const tokenFile = process.env.HH_TOKEN_FILE ?? ".tokens.json";
const userAgent = process.env.HH_USER_AGENT ?? "HH-Resume-MCP/0.1";

if (!clientId || !clientSecret) {
  console.error("Заполни HH_CLIENT_ID и HH_CLIENT_SECRET в локальном .env файле.");
  process.exit(1);
}

const state = randomBytes(24).toString("hex");
const authorize = new URL("https://hh.ru/oauth/authorize");
authorize.search = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: redirectUri,
  state
}).toString();

console.log("\nОткрой ссылку и подтверди доступ к своему аккаунту HH:\n");
console.log(authorize.toString());
console.log("\nОжидаю OAuth callback на " + redirectUri + "\n");

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", redirectUri);
    if (url.pathname !== new URL(redirectUri).pathname) {
      res.writeHead(404).end("Not found");
      return;
    }
    const returnedState = url.searchParams.get("state") ?? "";
    const a = Buffer.from(returnedState);
    const b = Buffer.from(state);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.writeHead(400).end("Invalid OAuth state. You can close this tab.");
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400).end("HH did not return an authorization code.");
      return;
    }

    const response = await fetch("https://hh.ru/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": userAgent },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId!,
        client_secret: clientSecret!,
        code,
        redirect_uri: redirectUri
      })
    });
    if (!response.ok) throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);

    const data = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
    await writeFile(tokenFile, JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000 - 60_000
    }, null, 2), { mode: 0o600 });

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>HH подключён.</h2><p>Токены сохранены локально. Можно закрыть вкладку.</p>");
    console.log("OAuth завершён. Токены сохранены в " + tokenFile);
    setTimeout(() => server.close(), 250);
  } catch (error) {
    console.error(error);
    res.writeHead(500).end("OAuth error. Check the terminal.");
    setTimeout(() => server.close(), 250);
  }
});

server.listen(new URL(redirectUri).port || 8765, "127.0.0.1");
