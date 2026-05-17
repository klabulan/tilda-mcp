#!/usr/bin/env node
// Smoke-7: button with CORRECT schema (caption, not text). Test multiple link-field names
// to discover which one Tilda accepts as the click target.

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

  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke7", version: "0" } });

  console.log("\n[1] create_page");
  const cp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke7-btn", alias: "smoke7-btn" } })).content[0].text);
  const pageId = cp.page_id;

  console.log("[2] add popup T1093");
  const popup = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T1093", position: null } })).content[0].text);
  const popupHref = `#popup:t1093_${popup.block_id}`;

  console.log("[3] add ZB hero");
  const zb = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T396", position: null } })).content[0].text);

  console.log("[4] import_zeroblock with 3 buttons trying different link-field names");
  const now = Date.now();
  const code = {
    "0": {
      elem_id: String(now), elem_type: "text",
      top: "100", left: "60", width: "1200", height: "120",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 4, hidden: "n",
      fontsize: "80", color: "#0a0a0a", fontfamily: "Arial",
      lineheight: "1.1", fontweight: "800", shadow_text_opacity: "100",
      textfit: "autoheight", valign: "middle",
      text: "Buttons test",
    },
    // Variant A: link = popupHref
    "1": {
      elem_id: String(now + 1), elem_type: "button",
      top: "260", left: "60", width: "200",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 5, hidden: "n",
      caption: "Open popup (A)",          // CORRECT: caption, not text
      height: "55", fontsize: "16", color: "#ffffff", fontfamily: "Arial",
      fontweight: "700", bgcolor: "#ff5a4e", borderradius: "8 8 8 8",
      link: popupHref,                    // try `link`
    },
    // Variant B: linkurl
    "2": {
      elem_id: String(now + 2), elem_type: "button",
      top: "260", left: "300", width: "200",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 5, hidden: "n",
      caption: "Open popup (B)",
      height: "55", fontsize: "16", color: "#ffffff", fontfamily: "Arial",
      fontweight: "700", bgcolor: "#4e8bff", borderradius: "8 8 8 8",
      linkurl: popupHref,
    },
    // Variant C: just href
    "3": {
      elem_id: String(now + 3), elem_type: "button",
      top: "260", left: "540", width: "200",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 5, hidden: "n",
      caption: "Open popup (C)",
      height: "55", fontsize: "16", color: "#ffffff", fontfamily: "Arial",
      fontweight: "700", bgcolor: "#4eff8b", borderradius: "8 8 8 8",
      href: popupHref,
    },
    groups: [], ab_height: "440", ab_bgcolor: "#fafafa",
    ab_filteropacity: "0.5", ab_filteropacity2: "0.5",
    ab_bgattachment: "scroll", ab_bgposition: "center center",
    ab_valign: "center", ab_upscale: "grid",
    timestamp: now, meta: { feeds: {} },
  };
  await call("tools/call", { name: "import_zeroblock", arguments: { pageid: pageId, zero_block_json: { recordid: zb.block_id, code }, position: null } });

  console.log("[5] publish");
  const pub = JSON.parse((await call("tools/call", { name: "publish", arguments: { pageid: pageId } }, 60_000)).content[0].text);
  console.log(`  ${pub.published_url}`);

  console.log("[6] verify rendering of each variant");
  await new Promise(r => setTimeout(r, 4000));
  const html = await (await fetch(pub.published_url)).text();
  for (const v of ["(A)", "(B)", "(C)"]) {
    console.log(`  has "Open popup ${v}": ${html.includes(`Open popup ${v}`)}`);
  }
  console.log(`  has popupHref any: ${html.includes(popupHref)}`);
  // Find which variant has actual <a href=...>
  const linkPattern = /<a [^>]*href="#popup[^"]*"[^>]*>([^<]+)/g;
  const linkMatches = [...html.matchAll(linkPattern)].slice(0, 5);
  console.log(`  <a href="#popup:..."> tags found:`);
  linkMatches.forEach(m => console.log(`    "${m[1].trim()}" href=${m[0].match(/href="([^"]+)"/)?.[1]}`));

  child.kill();
  console.log(`\n  ${pub.published_url}`);
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
