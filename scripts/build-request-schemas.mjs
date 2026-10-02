/* Builds the compact request-schema bundle shipped by the generation client.
   Catalog snapshots are authoritative; sync-catalog calls this after refresh. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "pika-catalog");
const target = join(here, "..", "src", "generation", "request-schemas.json");

export function buildRequestSchemas() {
  const schemas = {};
  for (const file of readdirSync(source).sort()) {
    if (!file.endsWith(".json")) continue;
    const api = JSON.parse(readFileSync(join(source, file), "utf8"));
    if (!api.api_id || !api.input_schema || Object.keys(api.input_schema).length === 0) continue;
    schemas[api.api_id] = api.input_schema;
  }
  writeFileSync(target, `${JSON.stringify(schemas)}\n`);
  return Object.keys(schemas).length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = buildRequestSchemas();
  console.log(`${count} request schemas written to src/generation/request-schemas.json`);
}
