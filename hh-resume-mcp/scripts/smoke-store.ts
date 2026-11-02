import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalCwd = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "career-mcp-store-"));

try {
  process.chdir(sandbox);
  const { importVacancies } = await import("../src/vacancy-store.ts");

  const vacancy = {
    title: "Junior Frontend Developer (React)",
    company: "Example",
    url: "https://example.com/jobs/123?utm_source=test",
    source: "Хабр Карьера" as const,
    location: "Екатеринбург",
    remote: true,
    salary_from: 60000,
    salary_to: 90000,
    currency: "RUB",
    description: "React, TypeScript, JavaScript",
    tags: ["frontend", "react"]
  };

  const first = await importVacancies([vacancy]);
  assert.match(first, /Новых: 1/);

  const duplicate = await importVacancies([{
    ...vacancy,
    url: "https://example.com/jobs/123",
    description: "Обновлённое описание с дополнительными подробностями о React и TypeScript"
  }]);
  assert.match(duplicate, /Новых: 0/);
  assert.match(duplicate, /обновлено совпадающих: 1/i);

  const savedPath = join(sandbox, ".career-data", "vacancies.json");
  const saved = JSON.parse(await readFile(savedPath, "utf8"));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].description, "Обновлённое описание с дополнительными подробностями о React и TypeScript");
  assert.equal(saved[0].status, "new");
  assert.equal(saved[0].salary_from, 60000);

  await importVacancies([{
    ...vacancy,
    company: "",
    location: "",
    remote: false,
    salary_from: null,
    salary_to: null,
    currency: "RUB",
    description: "",
    tags: []
  }]);
  const afterSparseUpdate = JSON.parse(await readFile(savedPath, "utf8"));
  assert.equal(afterSparseUpdate[0].company, "Example");
  assert.equal(afterSparseUpdate[0].location, "Екатеринбург");
  assert.equal(afterSparseUpdate[0].remote, true);
  assert.equal(afterSparseUpdate[0].description, "Обновлённое описание с дополнительными подробностями о React и TypeScript");
  assert.deepEqual(afterSparseUpdate[0].tags, ["frontend", "react"]);
  assert.equal(afterSparseUpdate[0].salary_from, 60000);

  await mkdir(join(sandbox, ".career-data"), { recursive: true });
  await writeFile(savedPath, "{broken json", "utf8");
  await assert.rejects(() => importVacancies([vacancy]), /JSON|position|Unexpected/i);
  assert.equal(await readFile(savedPath, "utf8"), "{broken json");

  console.log("[PASS] vacancy store: import, URL deduplication, update, field persistence, corrupt JSON protection");
} finally {
  process.chdir(originalCwd);
  await rm(sandbox, { recursive: true, force: true });
}
