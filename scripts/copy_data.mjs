#!/usr/bin/env node
// Copy src/data/*.json into dist/data/ after tsc (tsc only emits .js/.d.ts).
import { mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src/data");
const DST = join(ROOT, "dist/data");
mkdirSync(DST, { recursive: true });
for (const f of readdirSync(SRC)) {
  if (f.endsWith(".json") || f.endsWith(".md")) {
    copyFileSync(join(SRC, f), join(DST, f));
    console.log(`copied src/data/${f} → dist/data/${f}`);
  }
}
