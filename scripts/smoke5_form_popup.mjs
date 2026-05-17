#!/usr/bin/env node
// Smoke-5: build a page with Zero Block hero + simple form (T2441 BF201N) + popup (T1093).
// Verify they're added and visible in published HTML.

import { spawn } from "node:child_process";
import { join } from "node:path";

const SERVER = join(process.cwd(), "dist/index.js");
const PROJECT_ID = "25668306";

function send(child, id, m, p) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: m, params: p }) + "\n"); }

async function main() {
  const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  child.stderr.on("data", (d) => process.stderr.write(`[srv] ${d}`));
  const responses = new Map(); let buf = "";
  child.stdout.on("data", (chunk) => { buf += chunk.toString(); let nl; while ((nl = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!l.trim()) continue; try { const m = JSON.parse(l); if (m.id) responses.set(m.id, m); } catch {} } });
  async function call(method, params, timeoutMs = 30_000) { const id = Math.floor(Math.random() * 1e9); send(child, id, method, params); const s = Date.now(); while (!responses.has(id) && Date.now() - s < timeoutMs) await new Promise(r => setTimeout(r, 100)); const r = responses.get(id); if (!r) throw new Error(`timeout ${method}`); if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`); return r.result; }

  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke5", version: "0" } });

  console.log("\n[1] create_page");
  const cp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke5-form", alias: "smoke5-form" } })).content[0].text);
  const pageId = cp.page_id;
  console.log(`  pageid=${pageId}`);

  // 1) Zero Block hero
  console.log("\n[2] add Zero Block (hero)");
  const zb = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T396", position: null } })).content[0].text);
  console.log(`  zb_record=${zb.block_id}`);
  const now = Date.now();
  const heroCode = {
    "0": { elem_id: String(now), elem_type: "text", top: "100", left: "60", width: "1200", height: "140", heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px", zindex: 4, hidden: "n", fontsize: "92", color: "#0a0a0a", fontfamily: "Arial", lineheight: "1.1", fontweight: "800", shadow_text_opacity: "100", textfit: "autoheight", valign: "middle", text: "MCP-built landing", animstyle: "fadeindown", animduration: "1.0", animdelay: "0", animdistance: "60", animtriggeroffset: "100" },
    "1": { elem_id: String(now + 1), elem_type: "text", top: "270", left: "60", width: "900", height: "60", heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px", zindex: 5, hidden: "n", fontsize: "22", color: "#555555", fontfamily: "Arial", lineheight: "1.5", fontweight: "400", shadow_text_opacity: "100", textfit: "autoheight", valign: "middle", text: "Hero, форма подписки, попап — собрано через MCP без клика в Tilda UI.", animstyle: "fadeinleft", animduration: "0.9", animdelay: "0.3", animdistance: "120", animtriggeroffset: "100" },
    groups: [], ab_height: "440", ab_bgcolor: "#fafafa", ab_filteropacity: "0.5", ab_filteropacity2: "0.5", ab_bgattachment: "scroll", ab_bgposition: "center center", ab_valign: "center", ab_upscale: "grid", timestamp: now, meta: { feeds: {} },
  };
  await call("tools/call", { name: "import_zeroblock", arguments: { pageid: pageId, zero_block_json: { recordid: zb.block_id, code: heroCode }, position: null } });
  console.log(`  hero content saved`);

  // 2) Form T2441 (BF201N — single-input subscribe form)
  console.log("\n[3] add T2441 form (BF201N)");
  const form = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T2441", position: null } })).content[0].text);
  console.log(`  form_record=${form.block_id}`);

  // 3) Popup with Zero Block T1093
  console.log("\n[4] add T1093 popup (Popup с Zero Block)");
  const popup = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T1093", position: null } })).content[0].text);
  console.log(`  popup_record=${popup.block_id}`);

  // 4) Publish
  console.log("\n[5] publish");
  const pub = JSON.parse((await call("tools/call", { name: "publish", arguments: { pageid: pageId } }, 60_000)).content[0].text);
  console.log(`  ${pub.published_url}`);

  // 5) Verify
  console.log("\n[6] fetch + count blocks in HTML");
  await new Promise(r => setTimeout(r, 4000));
  const r = await fetch(pub.published_url);
  const html = await r.text();
  const recH1 = (html.match(/record\d+/g) || []);
  const uniqueRec = [...new Set(recH1)];
  console.log(`  HTTP ${r.status}, unique record-ids in published HTML: ${uniqueRec.length}`);
  console.log(`  records: ${uniqueRec.join(", ")}`);
  console.log(`  has form input: ${/<input[^>]*name=["']email/i.test(html) || /<input[^>]*type=["']email/i.test(html)}`);
  console.log(`  has popup container: ${/t-popup|t1093/i.test(html)}`);
  console.log(`  has hero text: ${html.includes("MCP-built landing")}`);

  child.kill();
  console.log(`\n=== smoke5 done ===`);
  console.log(`  public URL: ${pub.published_url}`);
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
