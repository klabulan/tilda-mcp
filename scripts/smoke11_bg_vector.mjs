#!/usr/bin/env node
// Smoke-11: probe ZB ab_bgimage + vector element + button hover fields.
// All via import_zeroblock — single fast roundtrip.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SERVER = join(process.cwd(), "dist/index.js");
const PROJECT_ID = "25668306";

// Real 800x400 horizontal gradient PNG (visible BG)
const BG_B64 = (() => {
  // Tiny 100×60 jpg-like dark gradient (just enough to verify "image rendered")
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAGQAAAA8CAYAAACu7tj3AAAAGUlEQVR42u3AAQ0AAADCoPdPbQ43oAAAAOAOBPgAAVqADCgAAAAASUVORK5CYII=";
  return b64;
})();

function send(child, id, m, p) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: m, params: p }) + "\n"); }

async function main() {
  // Write BG PNG
  const bgPath = "/tmp/tilda-mcp-bg.png";
  writeFileSync(bgPath, Buffer.from(BG_B64, "base64"));

  const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  child.stderr.on("data", (d) => process.stderr.write(`[srv] ${d}`));
  const responses = new Map(); let buf = "";
  child.stdout.on("data", (chunk) => { buf += chunk.toString(); let nl; while ((nl = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!l.trim()) continue; try { const m = JSON.parse(l); if (m.id) responses.set(m.id, m); } catch {} } });
  async function call(method, params, timeoutMs = 30_000) { const id = Math.floor(Math.random() * 1e9); send(child, id, method, params); const s = Date.now(); while (!responses.has(id) && Date.now() - s < timeoutMs) await new Promise(r => setTimeout(r, 100)); const r = responses.get(id); if (!r) throw new Error(`timeout ${method}`); if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`); return r.result; }
  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke11", version: "0" } });

  console.log("[1] create_page + scratch ZB for upload context");
  const scratchCp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke11-scratch", alias: "smoke11-scratch" } })).content[0].text);
  const scratchPage = scratchCp.page_id;
  const scratchZb = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: scratchPage, block_type: "T396", position: null } })).content[0].text);

  console.log("[2] upload BG image");
  const up = JSON.parse((await call("tools/call", { name: "upload_image", arguments: { file_path: bgPath, name: "smoke11-bg.png", scratch_pageid: scratchPage, scratch_recordid: scratchZb.block_id } }, 60_000)).content[0].text);
  console.log(`  cdn_url=${up.cdn_url}`);

  console.log("\n[3] create target page + ZB to test bg/vector/hover");
  const cp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke11-test", alias: "smoke11-test" } })).content[0].text);
  const pageId = cp.page_id;
  const zb = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T396", position: null } })).content[0].text);

  const now = Date.now();
  const code = {
    "0": {
      elem_id: String(now), elem_type: "text",
      top: "40", left: "60", width: "1100", height: "70",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 4, hidden: "n",
      fontsize: "44", color: "#ffffff", fontfamily: "Arial",
      lineheight: "1.1", fontweight: "800",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "BG image / vector / hover smoke",
    },
    "1": {
      // SVG vector (red circle)
      elem_id: String(now + 1), elem_type: "vector",
      top: "150", left: "60", width: "80", height: "80",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 5, hidden: "n",
      vectorsvg: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg"><circle cx="40" cy="40" r="36" fill="#ff5a4e" stroke="#ffffff" stroke-width="4"/></svg>`,
      filewidth: 80, fileheight: 80,
    },
    "2": {
      // Button with assumed hover fields (testing if Tilda accepts them)
      elem_id: String(now + 2), elem_type: "button",
      top: "260", left: "60", width: "240",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 6, hidden: "n",
      caption: "HOVER ME",
      link: "https://github.com/klabulan/tilda-mcp",
      target: "_blank",
      height: "60", fontsize: "18", color: "#ffffff", fontfamily: "Arial",
      fontweight: "700", bgcolor: "#ff5a4e", borderradius: "8 8 8 8",
      speedhover: "0.3",
      // ASSUMED hover fields — testing if Tilda saves them
      hover_bgcolor: "#4e8bff",
      hover_color: "#ffff00",
      hover_borderradius: "30 30 30 30",
    },
    groups: [],
    ab_height: "400", ab_bgcolor: "#1a1a1a",
    ab_filteropacity: "0.5", ab_filteropacity2: "0.5",
    ab_bgattachment: "scroll", ab_bgposition: "center center",
    ab_valign: "center", ab_upscale: "grid",
    // ASSUMED ab_bgimage field — testing if Tilda accepts artboard bg image
    ab_bgimage: up.cdn_url,
    timestamp: now, meta: { feeds: {} },
  };
  await call("tools/call", { name: "import_zeroblock", arguments: { pageid: pageId, zero_block_json: { recordid: zb.block_id, code }, position: null } });

  console.log("[4] read back, check what Tilda preserved");
  const after = JSON.parse((await call("tools/call", { name: "get_zeroblock", arguments: { pageid: pageId, recordid: zb.block_id } })).content[0].text);
  console.log(`  artboard ab_bgimage in returned JSON: ${after.ab_bgimage ?? "<absent>"}`);
  console.log(`  vector elem.vectorsvg present: ${after["1"]?.vectorsvg ? "yes (" + after["1"].vectorsvg.length + "b)" : "no"}`);
  console.log(`  button hover_bgcolor: ${after["2"]?.hover_bgcolor ?? "<absent>"}`);
  console.log(`  button hover_color:   ${after["2"]?.hover_color ?? "<absent>"}`);

  console.log("[5] publish");
  const pub = JSON.parse((await call("tools/call", { name: "publish", arguments: { pageid: pageId } }, 60_000)).content[0].text);
  console.log(`  ${pub.published_url}`);

  console.log("\n[6] inspect published HTML");
  await new Promise(r => setTimeout(r, 4000));
  const html = await (await fetch(pub.published_url)).text();
  console.log(`  has BG cdn url in HTML: ${html.includes(up.cdn_url)}`);
  console.log(`  has background-image CSS: ${/background-image:[^;]*url/i.test(html)}`);
  console.log(`  has <circle> (vector rendered): ${html.includes("<circle")}`);
  console.log(`  has "HOVER ME": ${html.includes("HOVER ME")}`);
  console.log(`  has hover bgcolor #4e8bff: ${html.includes("#4e8bff")}`);

  child.kill();
  console.log(`\n=== smoke11 done ===`);
  console.log(`  ${pub.published_url}`);
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
