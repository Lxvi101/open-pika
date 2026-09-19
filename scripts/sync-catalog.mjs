/* Refreshes scripts/pika-catalog from the public catalog. No key needed. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPricing } from "./build-pricing.mjs";

const BASE = process.env.PIKA_API_BASE_URL || "https://api.dev.pika.art";
const out = join(dirname(fileURLToPath(import.meta.url)), "pika-catalog");
mkdirSync(out, { recursive: true });

async function get(path) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${BASE}${path}`);
    if (response.ok) return response.text();
    if (response.status !== 429 || attempt >= 6) throw new Error(`${path}: ${response.status}`);
    await new Promise((done) => setTimeout(done, 4000 * (attempt + 1)));
  }
}

const { apis } = JSON.parse(await get("/catalog/apis"));
for (const api of apis) {
  const body = await get(`/catalog/apis/${api.api_id}?expand=inputs`);
  writeFileSync(join(out, `${api.api_id.replaceAll("/", "__")}.json`), body);
  await new Promise((done) => setTimeout(done, 700));
}
console.log(`${apis.length} operations written to scripts/pika-catalog`);
console.log(`${buildPricing()} operations priced in src/generation/catalog/pricing.json`);
