/* Boils scripts/pika-catalog down to the price list the studio ships:
   src/generation/catalog/pricing.json, keyed by api_id. Reads the files already
   on disk, so it needs no network; sync-catalog runs it after every refresh. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "pika-catalog");
const target = join(here, "..", "src", "generation", "catalog", "pricing.json");

export function buildPricing() {
  const pricing = {};
  for (const file of readdirSync(source).sort()) {
    if (!file.endsWith(".json")) continue;
    const api = JSON.parse(readFileSync(join(source, file), "utf8"));
    const components = api.display_pricing?.components ?? [];
    if (components.length === 0) continue;
    pricing[api.api_id] = components.map((component) => ({
      role: component.role,
      unit: component.unit.type,
      per: component.unit.quantity,
      ...(component.unit.included ? { included: component.unit.included } : {}),
      tiers: component.price_tiers.map((tier) => ({
        spec: Object.fromEntries(
          Object.entries(tier.spec).map(([key, value]) => [key, String(value)]),
        ),
        usd: tier.micro_usd / 1_000_000,
      })),
    }));
  }
  writeFileSync(target, `${JSON.stringify(pricing, null, 1)}\n`);
  return Object.keys(pricing).length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`${buildPricing()} operations priced in src/generation/catalog/pricing.json`);
}
