#!/usr/bin/env node
// Smoke-4: build a page where two elements have scroll-triggered animations (animstyle).
// Verify the animstyle persists round-trip via get_zeroblock.

import { spawn } from "node:child_process";
import { join } from "node:path";

const SERVER = join(process.cwd(), "dist/index.js");
const PROJECT_ID = "25668306";

function send(child, id, m, p) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: m, params: p }) + "\n"); }

async function main() {
  const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  child.stderr.on("data", (d) => process.stderr.write(`[srv] ${d}`));
  const responses = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => { buf += chunk.toString(); let nl; while ((nl = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!l.trim()) continue; try { const m = JSON.parse(l); if (m.id) responses.set(m.id, m); } catch {} } });
  async function call(method, params, timeoutMs = 30_000) { const id = Math.floor(Math.random() * 1e9); send(child, id, method, params); const s = Date.now(); while (!responses.has(id) && Date.now() - s < timeoutMs) await new Promise(r => setTimeout(r, 100)); const r = responses.get(id); if (!r) throw new Error(`timeout ${method}`); if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`); return r.result; }

  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke4", version: "0" } });

  console.log("\n[1] create_page");
  const cp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke4-anim", alias: "smoke4-anim" } })).content[0].text);
  const pageId = cp.page_id;
  console.log(`  pageid=${pageId}`);

  console.log("\n[2] add_block T396");
  const ab = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T396", position: null } })).content[0].text);
  const recordId = ab.block_id;
  console.log(`  recordid=${recordId}`);

  console.log("\n[3] import_zeroblock with TWO animated text elements");
  const now = Date.now();
  const code = {
    "0": {
      elem_id: String(now),
      elem_type: "text",
      top: "120", left: "60", width: "1100", height: "120",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 4, hidden: "n",
      fontsize: "80", color: "#0a0a0a", fontfamily: "Arial",
      lineheight: "1.1", fontweight: "800",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "Анимация работает",
      // ANIMATION fields
      animstyle: "fadeindown",
      animduration: "1.2",
      animdelay: "0",
      animdistance: "60",
      animtriggeroffset: "100",
    },
    "1": {
      elem_id: String(now + 1),
      elem_type: "text",
      top: "280", left: "60", width: "1000", height: "60",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 5, hidden: "n",
      fontsize: "24", color: "#555555", fontfamily: "Arial",
      lineheight: "1.5", fontweight: "400",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "Этот заголовок появляется сверху, а текст ниже — слева, через 0.4с после.",
      animstyle: "fadeinleft",
      animduration: "1.0",
      animdelay: "0.4",
      animdistance: "120",
      animtriggeroffset: "100",
    },
    "2": {
      elem_id: String(now + 2),
      elem_type: "shape",
      top: "400", left: "60", width: "200", height: "10",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 3, hidden: "n",
      figure: "rectangle", bgcolor: "#ff5a4e", borderradius: "5px 5px 5px 5px",
      layer: "accent",
      animstyle: "zoomin",
      animduration: "0.8",
      animdelay: "0.8",
      animscale: "0.4",
      animtriggeroffset: "100",
    },
    groups: [],
    ab_height: "550",
    ab_bgcolor: "#fafafa",
    ab_filteropacity: "0.5", ab_filteropacity2: "0.5",
    ab_bgattachment: "scroll", ab_bgposition: "center center",
    ab_valign: "center", ab_upscale: "grid",
    timestamp: now,
    meta: { feeds: {} },
  };
  const imp = JSON.parse((await call("tools/call", { name: "import_zeroblock", arguments: { pageid: pageId, zero_block_json: { recordid: recordId, code }, position: null } })).content[0].text);
  console.log(`  ${JSON.stringify(imp)}`);

  console.log("\n[4] get_zeroblock — verify animation fields persisted");
  const after = JSON.parse((await call("tools/call", { name: "get_zeroblock", arguments: { pageid: pageId, recordid: recordId } })).content[0].text);
  for (const k of ["0", "1", "2"]) {
    const e = after[k];
    console.log(`  [${k}] type=${e.elem_type} animstyle=${e.animstyle} dur=${e.animduration}s delay=${e.animdelay}s`);
  }

  console.log("\n[5] publish");
  const pub = JSON.parse((await call("tools/call", { name: "publish", arguments: { pageid: pageId } }, 60_000)).content[0].text);
  console.log(`  ${pub.published_url}`);

  console.log("\n[6] fetch published HTML — look for tn-elem__anim-* markers");
  await new Promise(r => setTimeout(r, 4000));
  const r = await fetch(pub.published_url);
  const html = await r.text();
  const animMatches = html.match(/tn-elem__anim-?\w*|data-anim-style|animstyle/gi);
  console.log(`  HTTP ${r.status}, animation markers in HTML: ${animMatches?.length ?? 0}`);
  console.log(`  has "Анимация работает": ${html.includes("Анимация работает")}`);
  console.log(`  has 'data-anim-style="fadeindown"': ${html.includes('"fadeindown"') || html.includes("'fadeindown'") || /data-anim[^=]*=["']?fadeindown/.test(html)}`);

  child.kill();
  console.log("\n=== smoke4 done ===");
  console.log(`  public URL: ${pub.published_url}`);
  console.log("  → scroll the page in a browser; the heading should fade-in from above,");
  console.log("    the subline from the left after 0.4s, then the accent line zooms in.");
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
