#!/usr/bin/env node
// Smoke-10: upload local image → use cdn_url in Zero Block image element → publish.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SERVER = join(process.cwd(), "dist/index.js");
const PROJECT_ID = "25668306";

// Real 200x200 PNG (gradient blue square via base64) — bigger than 1x1 so it visually shows
const TEST_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAYAAACtWK6eAAACQ0lEQVR4nO3SQQ0AIQzAwAFvFNZeNkohSe5pH+/dewG/d04PgL8mEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAIWWwGGAOdc1iSyzgAAAABJRU5ErkJggg==";

function send(child, id, m, p) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: m, params: p }) + "\n"); }

async function main() {
  // Write test PNG to /tmp
  const pngPath = "/tmp/tilda-mcp-smoke10.png";
  writeFileSync(pngPath, Buffer.from(TEST_PNG_B64, "base64"));
  console.log(`[0] test PNG written: ${pngPath}`);

  const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  child.stderr.on("data", (d) => process.stderr.write(`[srv] ${d}`));
  const responses = new Map(); let buf = "";
  child.stdout.on("data", (chunk) => { buf += chunk.toString(); let nl; while ((nl = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!l.trim()) continue; try { const m = JSON.parse(l); if (m.id) responses.set(m.id, m); } catch {} } });
  async function call(method, params, timeoutMs = 30_000) { const id = Math.floor(Math.random() * 1e9); send(child, id, method, params); const s = Date.now(); while (!responses.has(id) && Date.now() - s < timeoutMs) await new Promise(r => setTimeout(r, 100)); const r = responses.get(id); if (!r) throw new Error(`timeout ${method}`); if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`); return r.result; }

  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke10", version: "0" } });

  console.log("\n[1a] create scratch page + ZB for upload context");
  const scratchCp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "scratch-upload", alias: "scratch-upload" } })).content[0].text);
  const scratchPage = scratchCp.page_id;
  const scratchZb = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: scratchPage, block_type: "T396", position: null } })).content[0].text);
  console.log(`  scratch page=${scratchPage} zb=${scratchZb.block_id}`);

  console.log("\n[1b] upload_image (via Playwright)");
  const up = JSON.parse((await call("tools/call", {
    name: "upload_image",
    arguments: { file_path: pngPath, name: "mcp-test-200x200.png", scratch_pageid: scratchPage, scratch_recordid: scratchZb.block_id },
  }, 60_000)).content[0].text);
  console.log(`  cdn_url: ${up.cdn_url}`);
  console.log(`  ${up.width}x${up.height}, ${up.size}b, ${up.mime}`);

  console.log("\n[2] verify CDN URL responds");
  const r = await fetch(up.cdn_url, { method: "HEAD" });
  console.log(`  HEAD ${r.status} ${r.statusText}`);

  console.log("\n[3] create_page + add ZB + use image element with uploaded CDN URL");
  const cp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke10-img", alias: "smoke10-img" } })).content[0].text);
  const pageId = cp.page_id;
  const zb = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T396", position: null } })).content[0].text);

  const now = Date.now();
  const code = {
    "0": {
      elem_id: String(now), elem_type: "text",
      top: "60", left: "60", width: "1200", height: "80",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 4, hidden: "n",
      fontsize: "48", color: "#0a0a0a", fontfamily: "Arial",
      lineheight: "1.1", fontweight: "800",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "Uploaded image:",
    },
    "1": {
      elem_id: String(now + 1), elem_type: "image",
      top: "180", left: "60", width: String(up.width), height: String(up.height),
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 5, hidden: "n",
      img: up.cdn_url,
      filewidth: up.width, fileheight: up.height,
      imagefit: "auto", imageposition: "center center",
      borderradius: "8 8 8 8",
    },
    groups: [], ab_height: "500", ab_bgcolor: "#fafafa",
    ab_filteropacity: "0.5", ab_filteropacity2: "0.5",
    ab_bgattachment: "scroll", ab_bgposition: "center center",
    ab_valign: "center", ab_upscale: "grid",
    timestamp: now, meta: { feeds: {} },
  };
  await call("tools/call", { name: "import_zeroblock", arguments: { pageid: pageId, zero_block_json: { recordid: zb.block_id, code }, position: null } });

  console.log("\n[4] publish");
  const pub = JSON.parse((await call("tools/call", { name: "publish", arguments: { pageid: pageId } }, 90_000)).content[0].text);
  console.log(`  ${pub.published_url}`);

  console.log("\n[5] verify image embedded in published HTML");
  await new Promise(r => setTimeout(r, 4000));
  const html = await (await fetch(pub.published_url)).text();
  console.log(`  HTTP ${(await fetch(pub.published_url, { method: "HEAD" })).status}`);
  console.log(`  has CDN URL in HTML: ${html.includes(up.cdn_url)}`);
  console.log(`  has filename "mcp-test-200x200.png": ${html.includes("mcp-test-200x200.png")}`);

  child.kill();
  console.log(`\n=== smoke10 done ===`);
  console.log(`  ${pub.published_url}`);
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
