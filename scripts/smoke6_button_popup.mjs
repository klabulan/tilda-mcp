#!/usr/bin/env node
// Smoke-6: hero ZB with text + BUTTON → popup (T1093) wired via href="#popup:..."
// Tests assumed button-in-ZB schema; if save fails, fall back to UI exploration.

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

  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke6", version: "0" } });

  console.log("\n[1] create_page");
  const cp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke6-btn-popup", alias: "smoke6-btn-popup" } })).content[0].text);
  const pageId = cp.page_id;
  console.log(`  pageid=${pageId}`);

  // Add popup FIRST, so we know its recordid to wire the button.
  console.log("\n[2] add T1093 popup");
  const popup = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T1093", position: null } })).content[0].text);
  console.log(`  popup_record=${popup.block_id}`);

  console.log("\n[3] add Zero Block hero");
  const zb = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T396", position: null } })).content[0].text);
  console.log(`  hero_record=${zb.block_id}`);

  // Move popup to the END (after hero) — popups in Tilda usually live at the end.
  // (No move endpoint yet; Tilda may auto-order. We'll publish and see.)

  console.log("\n[4] import_zeroblock with text + BUTTON wired to popup");
  const now = Date.now();
  const popupHref = `#popup:t1093_${popup.block_id}`;   // assumed pattern
  const code = {
    "0": {
      elem_id: String(now), elem_type: "text",
      top: "100", left: "60", width: "1200", height: "120",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 4, hidden: "n",
      fontsize: "80", color: "#0a0a0a", fontfamily: "Arial",
      lineheight: "1.1", fontweight: "800",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "Click the button",
    },
    "1": {
      elem_id: String(now + 1), elem_type: "text",
      top: "250", left: "60", width: "900", height: "60",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 5, hidden: "n",
      fontsize: "22", color: "#555", fontfamily: "Arial",
      lineheight: "1.5", fontweight: "400",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "It should open the popup added separately.",
    },
    "2": {
      // ASSUMED button schema (TBD — verify by reading back)
      elem_id: String(now + 2), elem_type: "button",
      top: "340", left: "60", width: "200", height: "60",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 6, hidden: "n",
      // Text/styling
      text: "Open popup",
      fontsize: "18", color: "#ffffff", fontfamily: "Arial",
      fontweight: "700",
      // Button-specific (assumed names)
      bgcolor: "#ff5a4e",
      borderradius: "8px 8px 8px 8px",
      // Link / target
      href: popupHref,
      target: "_self",
    },
    groups: [],
    ab_height: "500", ab_bgcolor: "#fafafa",
    ab_filteropacity: "0.5", ab_filteropacity2: "0.5",
    ab_bgattachment: "scroll", ab_bgposition: "center center",
    ab_valign: "center", ab_upscale: "grid",
    timestamp: now, meta: { feeds: {} },
  };
  const imp = JSON.parse((await call("tools/call", { name: "import_zeroblock", arguments: { pageid: pageId, zero_block_json: { recordid: zb.block_id, code }, position: null } })).content[0].text);
  console.log(`  ${JSON.stringify(imp)}`);

  console.log("\n[5] get_zeroblock — what fields did Tilda preserve on the button?");
  const after = JSON.parse((await call("tools/call", { name: "get_zeroblock", arguments: { pageid: pageId, recordid: zb.block_id } })).content[0].text);
  console.log("  button element after round-trip:");
  console.log(JSON.stringify(after["2"], null, 2));

  console.log("\n[6] publish");
  const pub = JSON.parse((await call("tools/call", { name: "publish", arguments: { pageid: pageId } }, 60_000)).content[0].text);
  console.log(`  ${pub.published_url}`);

  console.log("\n[7] inspect published HTML — does the button + href + popup render?");
  await new Promise(r => setTimeout(r, 4000));
  const r = await fetch(pub.published_url);
  const html = await r.text();
  console.log(`  HTTP ${r.status}`);
  console.log(`  has button "Open popup": ${html.includes("Open popup")}`);
  console.log(`  has popup href '#popup:t1093': ${html.includes("#popup:t1093")}`);
  console.log(`  popup record-id in HTML: ${html.includes(popup.block_id)}`);

  child.kill();
  console.log(`\n=== smoke6 done — verify by clicking the button in browser ===`);
  console.log(`  ${pub.published_url}`);
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
