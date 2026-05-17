#!/usr/bin/env node
// Refresh src/data/tilda_templates.json from Tilda's live template DB.
// Run periodically (Tilda adds new templates).
// No auth needed — /page/tplslistjs/ is publicly accessible.

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "src/data/tilda_templates.json");

const PREFIX_CATEGORY = {
  CR: "cover", TX: "text", BF: "form", ME: "menu", FT: "footer",
  GL: "gallery", IM: "image", VD: "video", CL: "columns",
  FR: "features", TS: "testimonials", ST: "store", SM: "social",
  TE: "slider", IX: "index", QT: "quote", AB: "about", PR: "process",
};

async function main() {
  console.log("[1] fetch tplslist.js");
  const r = await fetch("https://tilda.ru/page/tplslistjs/?lang=ru");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const raw = await r.text();
  console.log(`  ${raw.length} bytes`);

  console.log("[2] extract $tpls array");
  const m = raw.match(/window\.\$tpls\s*=\s*(\[[\s\S]+?\]);/);
  if (!m) throw new Error("$tpls not found in tplslist.js");
  const tpls = JSON.parse(m[1]);
  console.log(`  ${tpls.length} templates`);

  console.log("[3] normalize + categorise");
  const out = tpls.map(t => {
    const cod = (t.cod || "").toUpperCase();
    let category = "other";
    for (const [p, c] of Object.entries(PREFIX_CATEGORY)) {
      if (cod.startsWith(p)) { category = c; break; }
    }
    // Title-based override for popups (their cod prefix varies)
    if (/попап|popup|модал/i.test(t.title || "")) category = "popup";
    return {
      tplid: t.id,
      code: t.cod || "",
      title: t.title || "",
      descr: t.descr || "",
      category,
      has_bg: t.hasblockbackground === "y",
    };
  });

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`[done] wrote ${out.length} templates → ${OUT}`);

  // stats
  const byCat = {};
  out.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + 1; });
  console.log("  categories:", JSON.stringify(byCat));
}

main().catch(e => { console.error("fail:", e.message); process.exit(1); });
