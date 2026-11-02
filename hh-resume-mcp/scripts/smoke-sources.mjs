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
    url: "https://getmatch.ru/vacancies/js_frontend",
    pattern: /href=["']\/vacancies\/\d+-[a-z0-9-]+/gi
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
    const response = await fetch(target.url, {
      headers: {
        "User-Agent": "CareerMCP-source-smoke-test/0.1 (read-only)",
        "Accept": "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(20000)
    });
    const html = await response.text();
    const count = [...html.matchAll(target.pattern)].length;
    console.log("[" + (response.ok && count > 0 ? "PASS" : "FAIL") + "] " + target.name + ": HTTP " + response.status + ", " + html.length + " bytes, " + count + " matching public links/cards");
    if (target.name === "Getmatch" && count === 0) {
      const titleStart = html.indexOf("<title");
      const titleEnd = html.indexOf("</title>");
      console.log("Getmatch page title: " + (titleStart >= 0 && titleEnd > titleStart ? html.slice(titleStart, titleEnd + 8) : "not found"));
      console.log("Getmatch script bundles: " + [...html.matchAll(/<script[^>]+src=["']([^"']+)/gi)].map(m => m[1]).slice(0, 20).join(" | "));
      for (const key of ["__NEXT_DATA__", "application/json", "vacancies/", "graphql", "api/"]) {
        const index = html.toLowerCase().indexOf(key.toLowerCase());
        if (index >= 0) console.log("Getmatch " + key + " snippet: " + html.slice(Math.max(0, index - 180), index + 650));
      }
    }
    if (!response.ok || count === 0) failed = true;
  } catch (error) {
    console.log("[FAIL] " + target.name + ": " + String(error));
    failed = true;
  }
}
if (failed) process.exitCode = 1;
