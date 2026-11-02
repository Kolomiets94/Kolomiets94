const targets = [
  {
    name: "Habr Career",
    url: "https://career.habr.com/vacancies/spec/development/frontend?page=1",
    pattern: /href=["']\/vacancies\/\d+/gi
  },
  {
    name: "GeekJob",
    url: "https://gkjb.ru/vacancies?page=1",
    pattern: /href=["']\/vacancy\/[a-z0-9-]+/gi
  },
  {
    name: "Getmatch",
    url: "https://getmatch.ru/api/offers?offset=0&limit=20",
    jsonOffers: true,
    pattern: /./
  },
  {
    name: "Telegram public feed",
    url: "https://t.me/s/forfrontend",
    pattern: /data-post=["'][^"']+\/\d+["'][\s\S]*?class=["'][^"']*tgme_widget_message_text/gi
  }
];

let failed = false;
for (const target of targets) {
  try {
    let response;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(target.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            "Accept": target.jsonOffers ? "application/json" : "text/html,application/xhtml+xml"
          },
          signal: AbortSignal.timeout(20000)
        });
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    if (!response) throw lastError || new Error("fetch failed after retries");
    const html = await response.text();
    const count = target.jsonOffers ? (JSON.parse(html).offers ?? []).length : [...html.matchAll(target.pattern)].length;
    console.log("[" + (response.ok && count > 0 ? "PASS" : "FAIL") + "] " + target.name + ": HTTP " + response.status + ", " + html.length + " bytes, " + count + " matching public links/cards");
    if (!response.ok || count === 0) failed = true;
  } catch (error) {
    console.log("[FAIL] " + target.name + ": " + String(error));
    failed = true;
  }
}
if (failed) process.exitCode = 1;
