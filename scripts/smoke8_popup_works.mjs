#!/usr/bin/env node
// Smoke-8: button.link=#zeropopup + popup ZB filled with content via import_zeroblock.

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

  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke8", version: "0" } });

  console.log("\n[1] create_page");
  const cp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke8-popup", alias: "smoke8-popup" } })).content[0].text);
  const pageId = cp.page_id;

  console.log("[2] add popup T1093 — its recordid is the inner ZB");
  const popup = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T1093", position: null } })).content[0].text);
  const popupRec = popup.block_id;

  console.log("[3] add hero ZB");
  const zb = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T396", position: null } })).content[0].text);
  const zbRec = zb.block_id;

  console.log("[4] fill popup ZB with content");
  const now = Date.now();
  const popupCode = {
    "0": {
      elem_id: String(now), elem_type: "text",
      top: "40", left: "40", width: "520", height: "60",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 4, hidden: "n",
      fontsize: "32", color: "#0a0a0a", fontfamily: "Arial",
      lineheight: "1.2", fontweight: "700",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "Hello from popup!",
    },
    "1": {
      elem_id: String(now + 1), elem_type: "text",
      top: "120", left: "40", width: "520", height: "60",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 5, hidden: "n",
      fontsize: "16", color: "#555", fontfamily: "Arial",
      lineheight: "1.55", fontweight: "400",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "This popup was opened via button click. Both the popup content and the trigger are 100% MCP-driven.",
    },
    groups: [], ab_height: "260", ab_bgcolor: "#ffffff",
    ab_filteropacity: "0.5", ab_filteropacity2: "0.5",
    ab_bgattachment: "scroll", ab_bgposition: "center center",
    ab_valign: "center", ab_upscale: "grid",
    timestamp: now, meta: { feeds: {} },
  };
  await call("tools/call", { name: "import_zeroblock", arguments: { pageid: pageId, zero_block_json: { recordid: popupRec, code: popupCode }, position: null } });

  console.log("[5] fill hero ZB with text + button (link=#zeropopup)");
  const heroCode = {
    "0": {
      elem_id: String(now + 10), elem_type: "text",
      top: "100", left: "60", width: "1200", height: "120",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 4, hidden: "n",
      fontsize: "80", color: "#0a0a0a", fontfamily: "Arial",
      lineheight: "1.1", fontweight: "800",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "Popup demo",
      animstyle: "fadeindown", animduration: "0.9", animdelay: "0",
    },
    "1": {
      elem_id: String(now + 11), elem_type: "text",
      top: "260", left: "60", width: "900", height: "50",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 5, hidden: "n",
      fontsize: "20", color: "#555", fontfamily: "Arial",
      lineheight: "1.5", fontweight: "400",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "Click the button — popup appears (link=#zeropopup, the Tilda-default hook).",
    },
    "2": {
      elem_id: String(now + 12), elem_type: "button",
      top: "350", left: "60", width: "240",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 6, hidden: "n",
      caption: "Open popup",
      link: "#zeropopup",
      height: "60", fontsize: "18", color: "#ffffff", fontfamily: "Arial",
      fontweight: "700", bgcolor: "#ff5a4e", borderradius: "8 8 8 8",
      speedhover: "0.2",
      animstyle: "fadeinup", animduration: "0.8", animdelay: "0.3", animdistance: "40",
    },
    groups: [], ab_height: "500", ab_bgcolor: "#fafafa",
    ab_filteropacity: "0.5", ab_filteropacity2: "0.5",
    ab_bgattachment: "scroll", ab_bgposition: "center center",
    ab_valign: "center", ab_upscale: "grid",
    timestamp: now, meta: { feeds: {} },
  };
  await call("tools/call", { name: "import_zeroblock", arguments: { pageid: pageId, zero_block_json: { recordid: zbRec, code: heroCode }, position: null } });

  console.log("[6] publish");
  const pub = JSON.parse((await call("tools/call", { name: "publish", arguments: { pageid: pageId } }, 60_000)).content[0].text);
  console.log(`  ${pub.published_url}`);

  console.log("[7] verify");
  await new Promise(r => setTimeout(r, 4000));
  const html = await (await fetch(pub.published_url)).text();
  console.log(`  has #zeropopup link: ${html.includes('href="#zeropopup"')}`);
  console.log(`  has popup hook: ${html.includes('data-tooltip-hook="#zeropopup"')}`);
  console.log(`  has popup content "Hello from popup!": ${html.includes("Hello from popup!")}`);
  console.log(`  has button caption "Open popup": ${html.includes("Open popup")}`);
  console.log(`  has hero "Popup demo": ${html.includes("Popup demo")}`);

  child.kill();
  console.log(`\n  ${pub.published_url}`);
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
