#!/usr/bin/env node
// Smoke-3: create page → add ZB → import_zeroblock with real text/shape content → publish → verify content visible.

import { spawn } from "node:child_process";
import { join } from "node:path";

const SERVER = join(process.cwd(), "dist/index.js");
const PROJECT_ID = "25668306";

function send(child, id, method, params) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); }

async function main() {
  const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  child.stderr.on("data", (d) => process.stderr.write(`[srv] ${d}`));
  const responses = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl; while ((nl = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!l.trim()) continue; try { const m = JSON.parse(l); if (m.id) responses.set(m.id, m); } catch {} }
  });
  async function call(method, params, timeoutMs = 30_000) {
    const id = Math.floor(Math.random() * 1e9);
    send(child, id, method, params);
    const s = Date.now();
    while (!responses.has(id) && Date.now() - s < timeoutMs) await new Promise(r => setTimeout(r, 100));
    const r = responses.get(id);
    if (!r) throw new Error(`timeout ${method}`);
    if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`);
    return r.result;
  }

  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke3", version: "0" } });

  console.log("\n[1] create_page");
  const cp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke3-content", alias: "smoke3-content" } })).content[0].text);
  const pageId = cp.page_id;
  console.log(`  pageid=${pageId}`);

  console.log("\n[2] add_block T396 (empty Zero Block)");
  const ab = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T396", position: null } })).content[0].text);
  const recordId = ab.block_id;
  console.log(`  recordid=${recordId}`);

  console.log("\n[3] get_zeroblock (read current empty state)");
  const before = JSON.parse((await call("tools/call", { name: "get_zeroblock", arguments: { pageid: pageId, recordid: recordId } })).content[0].text);
  console.log(`  keys before: ${Object.keys(before).join(", ")}`);

  console.log("\n[4] import_zeroblock (real content: heading + paragraph + accent shape)");
  const now = Date.now();
  const code = {
    "0": {
      elem_id: String(now),
      elem_type: "text",
      top: "80", left: "40", width: "1120", height: "120",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 4, hidden: "n",
      fontsize: "72", color: "#1a1a1a", fontfamily: "Arial",
      lineheight: "1.1", fontweight: "700",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "Hello from tilda-mcp",
    },
    "1": {
      elem_id: String(now + 1),
      elem_type: "text",
      top: "230", left: "40", width: "900", height: "60",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 5, hidden: "n",
      fontsize: "22", color: "#444444", fontfamily: "Arial",
      lineheight: "1.5", fontweight: "400",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "This block was created entirely through the MCP server — create_page, add_block, import_zeroblock, publish — with zero manual UI work.",
    },
    "2": {
      elem_id: String(now + 2),
      elem_type: "shape",
      top: "340", left: "40", width: "120", height: "8",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 3, hidden: "n",
      figure: "rectangle", bgcolor: "#ff5a4e", borderradius: "4px 4px 4px 4px",
      layer: "accent",
    },
    groups: [],
    ab_height: "450",
    ab_bgcolor: "#ffffff",
    ab_filteropacity: "0.5",
    ab_filteropacity2: "0.5",
    ab_bgattachment: "scroll",
    ab_bgposition: "center center",
    ab_valign: "center",
    ab_upscale: "grid",
    timestamp: now,
    meta: { feeds: {} },
  };
  const imp = JSON.parse((await call("tools/call", {
    name: "import_zeroblock",
    arguments: { pageid: pageId, zero_block_json: { recordid: recordId, code }, position: null }
  })).content[0].text);
  console.log(`  ${JSON.stringify(imp)}`);

  console.log("\n[5] get_zeroblock again (verify content saved)");
  const after = JSON.parse((await call("tools/call", { name: "get_zeroblock", arguments: { pageid: pageId, recordid: recordId } })).content[0].text);
  console.log(`  element 0 text: "${after["0"]?.text}"`);
  console.log(`  element 1 text: "${after["1"]?.text?.slice(0, 60)}..."`);
  console.log(`  element 2 figure: ${after["2"]?.figure} bg=${after["2"]?.bgcolor}`);

  console.log("\n[6] publish");
  const pub = JSON.parse((await call("tools/call", { name: "publish", arguments: { pageid: pageId } }, 60_000)).content[0].text);
  console.log(`  ${pub.published_url}`);

  console.log("\n[7] verify content visible on published URL");
  await new Promise(r => setTimeout(r, 4000));
  const r = await fetch(pub.published_url);
  console.log(`  HTTP ${r.status}`);
  const html = await r.text();
  const hasH1 = html.includes("Hello from tilda-mcp");
  const hasParagraph = html.includes("zero manual UI work");
  console.log(`  contains heading: ${hasH1}`);
  console.log(`  contains paragraph: ${hasParagraph}`);

  child.kill();
  if (!hasH1 || !hasParagraph) {
    console.error("\n!! smoke3 FAILED — content not visible on published URL");
    process.exit(1);
  }
  console.log("\n=== smoke3 PASSED — full content lifecycle works ===");
  console.log(`  public URL: ${pub.published_url}`);
}

main().catch((e) => { console.error("\n!! smoke3 fail:", e.message); process.exit(1); });
