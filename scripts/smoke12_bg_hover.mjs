#!/usr/bin/env node
// Smoke-12: verify BG image (ab_bgimg) + hover effects field names.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SERVER = join(process.cwd(), "dist/index.js");
const PROJECT_ID = "25668306";

const BG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAGQAAAA8CAYAAACu7tj3AAAAGUlEQVR42u3AAQ0AAADCoPdPbQ43oAAAAOAOBPgAAVqADCgAAAAASUVORK5CYII=";

function send(child, id, m, p) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: m, params: p }) + "\n"); }

async function main() {
  const bgPath = "/tmp/tilda-mcp-bg2.png";
  writeFileSync(bgPath, Buffer.from(BG_B64, "base64"));

  const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  child.stderr.on("data", (d) => process.stderr.write(`[srv] ${d}`));
  const responses = new Map(); let buf = "";
  child.stdout.on("data", (chunk) => { buf += chunk.toString(); let nl; while ((nl = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!l.trim()) continue; try { const m = JSON.parse(l); if (m.id) responses.set(m.id, m); } catch {} } });
  async function call(method, params, timeoutMs = 60_000) { const id = Math.floor(Math.random() * 1e9); send(child, id, method, params); const s = Date.now(); while (!responses.has(id) && Date.now() - s < timeoutMs) await new Promise(r => setTimeout(r, 100)); const r = responses.get(id); if (!r) throw new Error(`timeout ${method}`); if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`); return r.result; }
  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke12", version: "0" } });

  console.log("[1] create scratch + upload BG");
  const scratchCp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke12-scratch", alias: "smoke12-scratch" } })).content[0].text);
  const scratchZb = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: scratchCp.page_id, block_type: "T396", position: null } })).content[0].text);
  const up = JSON.parse((await call("tools/call", { name: "upload_image", arguments: { file_path: bgPath, name: "smoke12-bg.png", scratch_pageid: scratchCp.page_id, scratch_recordid: scratchZb.block_id } }, 90_000)).content[0].text);
  console.log(`  cdn=${up.cdn_url}`);

  console.log("\n[2] create test page + ZB with REAL field names");
  const cp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke12-real", alias: "smoke12-real" } })).content[0].text);
  const zb = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: cp.page_id, block_type: "T396", position: null } })).content[0].text);

  const now = Date.now();
  const code = {
    "0": {
      elem_id: String(now), elem_type: "text",
      top: "100", left: "60", width: "1100", height: "100",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 4, hidden: "n",
      fontsize: "64", color: "#ffffff", fontfamily: "Arial",
      lineheight: "1.1", fontweight: "800",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "BG image + hover smoke",
    },
    "1": {
      elem_id: String(now + 1), elem_type: "button",
      top: "260", left: "60", width: "260",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 5, hidden: "n",
      caption: "HOVER ME",
      link: "https://example.com",
      height: "60", fontsize: "18", color: "#ffffff", fontfamily: "Arial",
      fontweight: "700", bgcolor: "#ff5a4e", borderradius: "8 8 8 8",
      speedhover: "0.25",
      // REAL hover via `effects` object — TBD exact shape; try common patterns
      effects: JSON.stringify({
        bgcolor_hover: "#4e8bff",
        color_hover: "#ffff00",
      }),
      shadowshover: "0 8 24 0 rgba(78,139,255,0.45)",
      shadowshoverspeed: "0.25",
    },
    groups: [],
    ab_height: "400",
    ab_bgcolor: "#1a1a1a",
    // Test artboard BG image — try ab_bgimg (real field name found in elemFields.bgImageField)
    ab_bgimg: up.cdn_url,
    ab_filteropacity: "0.4", ab_filteropacity2: "0.4",
    ab_bgattachment: "scroll", ab_bgposition: "center center",
    ab_valign: "center", ab_upscale: "grid",
    timestamp: now, meta: { feeds: {} },
  };
  await call("tools/call", { name: "import_zeroblock", arguments: { pageid: cp.page_id, zero_block_json: { recordid: zb.block_id, code }, position: null } });

  console.log("\n[3] read back");
  const after = JSON.parse((await call("tools/call", { name: "get_zeroblock", arguments: { pageid: cp.page_id, recordid: zb.block_id } })).content[0].text);
  console.log(`  ab_bgimg returned: ${after.ab_bgimg ?? "<absent>"}`);
  console.log(`  button effects:    ${after["1"]?.effects ?? "<absent>"}`);
  console.log(`  button shadowshover: ${after["1"]?.shadowshover ?? "<absent>"}`);

  console.log("\n[4] publish");
  const pub = JSON.parse((await call("tools/call", { name: "publish", arguments: { pageid: cp.page_id } }, 90_000)).content[0].text);
  console.log(`  ${pub.published_url}`);
  await new Promise(r => setTimeout(r, 4000));
  const html = await (await fetch(pub.published_url)).text();
  console.log(`\n[5] HTML check:`);
  console.log(`  CDN URL embedded: ${html.includes(up.cdn_url)}`);
  console.log(`  has 'background-image' CSS rule: ${/background-image[^;}]*url/i.test(html)}`);
  console.log(`  has hover bgcolor #4e8bff: ${html.includes("#4e8bff")}`);
  console.log(`  has hover shadow rgba(78,139,255: ${html.includes("rgba(78,139,255")}`);

  child.kill();
  console.log(`\n  ${pub.published_url}`);
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
