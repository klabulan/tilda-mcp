#!/usr/bin/env node
// Smoke-9: T0868 HTML popup → edit_block fills `code` + custom `linkhook` → button in hero opens it.

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

  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke9", version: "0" } });

  console.log("[1] create_page");
  const cp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke9-popup", alias: "smoke9-popup" } })).content[0].text);
  const pageId = cp.page_id;

  console.log("[2] add T0868 HTML popup");
  const popup = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T0868", position: null } })).content[0].text);
  console.log(`  popupRec=${popup.block_id}`);

  console.log("[3] edit_block: fill popup HTML + custom hook '#mcpdemo'");
  await call("tools/call", {
    name: "edit_block",
    arguments: {
      blockid: popup.block_id,
      patch: {
        pageid: pageId,
        code: `<div style="padding:60px;text-align:center;font-family:Arial">
  <h2 style="margin:0 0 20px;font-size:42px;color:#0a0a0a">Popup от MCP</h2>
  <p style="margin:0 0 30px;font-size:18px;color:#555;line-height:1.5;max-width:480px;margin-left:auto;margin-right:auto">
    Это HTML-попап с кастомным хуком <code>#mcpdemo</code>. Содержимое и hook залиты через <strong>edit_block</strong>.
  </p>
  <a href="https://github.com/klabulan/tilda-mcp" target="_blank" style="display:inline-block;padding:14px 28px;background:#ff5a4e;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">github.com/klabulan/tilda-mcp</a>
</div>`,
        linkhook: "#mcpdemo",
      },
    },
  });

  console.log("[4] add hero ZB with button linking to #mcpdemo");
  const zb = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T396", position: null } })).content[0].text);
  const now = Date.now();
  const heroCode = {
    "0": {
      elem_id: String(now), elem_type: "text",
      top: "120", left: "60", width: "1200", height: "120",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 4, hidden: "n",
      fontsize: "84", color: "#0a0a0a", fontfamily: "Arial",
      lineheight: "1.1", fontweight: "800",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "Popup demo (real)",
      animstyle: "fadeindown", animduration: "0.9", animdelay: "0",
    },
    "1": {
      elem_id: String(now + 1), elem_type: "text",
      top: "270", left: "60", width: "1000", height: "60",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 5, hidden: "n",
      fontsize: "22", color: "#555", fontfamily: "Arial",
      lineheight: "1.5", fontweight: "400",
      shadow_text_opacity: "100", textfit: "autoheight", valign: "middle",
      text: "Click the button → HTML popup opens. Button.link=#mcpdemo (matches popup linkhook).",
    },
    "2": {
      elem_id: String(now + 2), elem_type: "button",
      top: "370", left: "60", width: "260",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 6, hidden: "n",
      caption: "Open MCP popup",
      link: "#mcpdemo",                  // matches linkhook
      height: "60", fontsize: "18", color: "#ffffff", fontfamily: "Arial",
      fontweight: "700", bgcolor: "#ff5a4e", borderradius: "8 8 8 8",
      speedhover: "0.2",
      animstyle: "fadeinup", animduration: "0.8", animdelay: "0.3", animdistance: "40",
    },
    groups: [], ab_height: "520", ab_bgcolor: "#fafafa",
    ab_filteropacity: "0.5", ab_filteropacity2: "0.5",
    ab_bgattachment: "scroll", ab_bgposition: "center center",
    ab_valign: "center", ab_upscale: "grid",
    timestamp: now, meta: { feeds: {} },
  };
  await call("tools/call", { name: "import_zeroblock", arguments: { pageid: pageId, zero_block_json: { recordid: zb.block_id, code: heroCode }, position: null } });

  console.log("[5] publish");
  const pub = JSON.parse((await call("tools/call", { name: "publish", arguments: { pageid: pageId } }, 60_000)).content[0].text);
  console.log(`  ${pub.published_url}`);

  console.log("[6] verify");
  await new Promise(r => setTimeout(r, 4000));
  const html = await (await fetch(pub.published_url)).text();
  console.log(`  has button: ${html.includes("Open MCP popup")}`);
  console.log(`  has button href #mcpdemo: ${html.includes('href="#mcpdemo"')}`);
  console.log(`  has popup hook #mcpdemo: ${html.includes('data-tooltip-hook="#mcpdemo"')}`);
  console.log(`  has popup content "Popup от MCP": ${html.includes("Popup от MCP")}`);
  console.log(`  has popup CTA "github.com/klabulan/tilda-mcp": ${html.includes("github.com/klabulan/tilda-mcp")}`);

  child.kill();
  console.log(`\n=== smoke9 done ===`);
  console.log(`  ${pub.published_url}`);
  console.log("  → click 'Open MCP popup' button → HTML popup with title/text/CTA appears");
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
