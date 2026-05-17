#!/usr/bin/env node
// Explore 28: capture REAL button-hover field structure by simulating UI change.
// Setup: create ZB with button, open it in editor, programmatically toggle hover state
// via window.elem__* and tn library helpers, save, capture diff.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PROJECT_ID = "25668306";

// Setup: page + ZB + import button via MCP server
const SERVER = "/home/levko/tilda-mcp/dist/index.js";
function send(child, id, m, p) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: m, params: p }) + "\n"); }

async function mcpSetup() {
  const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  child.stderr.on("data", () => {});
  const responses = new Map(); let buf = "";
  child.stdout.on("data", (chunk) => { buf += chunk.toString(); let nl; while ((nl = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!l.trim()) continue; try { const m = JSON.parse(l); if (m.id) responses.set(m.id, m); } catch {} } });
  async function call(method, params, timeoutMs = 60_000) {
    const id = Math.floor(Math.random() * 1e9); send(child, id, method, params);
    const s = Date.now();
    while (!responses.has(id) && Date.now() - s < timeoutMs) await new Promise(r => setTimeout(r, 100));
    const r = responses.get(id);
    if (!r) throw new Error(`timeout ${method}`);
    if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`);
    return r.result;
  }
  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "0" } });
  const cp = JSON.parse((await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "hover-real", alias: "hover-real" } })).content[0].text);
  const zb = JSON.parse((await call("tools/call", { name: "add_block", arguments: { pageid: cp.page_id, block_type: "T396", position: null } })).content[0].text);
  const now = Date.now();
  const code = {
    "0": {
      elem_id: String(now), elem_type: "button",
      top: "100", left: "100", width: "200",
      heightunits: "px", leftunits: "px", topunits: "px", widthunits: "px",
      zindex: 4, hidden: "n",
      caption: "TEST", link: "https://example.com",
      height: "55", fontsize: "16", color: "#ffffff", fontfamily: "Arial",
      fontweight: "600", bgcolor: "#000000", borderradius: "8 8 8 8",
    },
    groups: [], ab_height: "300", ab_bgcolor: "#fafafa",
    ab_filteropacity: "0.5", ab_filteropacity2: "0.5",
    ab_bgattachment: "scroll", ab_bgposition: "center center",
    ab_valign: "center", ab_upscale: "grid",
    timestamp: now, meta: { feeds: {} },
  };
  await call("tools/call", { name: "import_zeroblock", arguments: { pageid: cp.page_id, zero_block_json: { recordid: zb.block_id, code }, position: null } });
  child.kill();
  return { pageId: cp.page_id, recordId: zb.block_id, buttonId: String(now) };
}

async function main() {
  const { pageId, recordId, buttonId } = await mcpSetup();
  console.log(`page=${pageId} zb=${recordId} button=${buttonId}`);

  // Now open ZB editor, programmatically open button hover settings, set value, save
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US", timezoneId: "Europe/Berlin",
  });
  const fs = await import("node:fs");
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  await context.addCookies(state.cookies.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires,
    httpOnly: !!c.httpOnly, secure: !!c.secure,
    sameSite: c.sameSite === "Lax" ? "Lax" : c.sameSite === "None" ? "None" : c.sameSite === "Strict" ? "Strict" : "Lax",
  })));

  const zeroSaves = [];
  context.on("response", async (res) => {
    const u = res.request().url();
    if (!u.includes("/zero/submit/")) return;
    try {
      const body = (await res.body()).toString("utf8").slice(0, 200);
      const pd = res.request().postData() || "";
      const codeMatch = pd.match(/name="code"\r?\n\r?\n([^]+?)(\r?\n--)/);
      const codeStr = codeMatch ? codeMatch[1] : "<no-code-field>";
      zeroSaves.push({ status: res.status(), body, code: codeStr });
    } catch {}
  });

  const page = await context.newPage();
  page.on("dialog", d => d.accept());

  console.log("[1] open ZB editor");
  await page.goto(`https://tilda.ru/zero/?recordid=${recordId}&pageid=${pageId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 4000));

  console.log("[2] select button + programmatically set effects.bgcolor + save");
  const result = await page.evaluate((bid) => {
    // Get current data from tn library
    const tnFns = Object.keys(window).filter(k => /^(tn_|elem__|tnzb__|save|update)/.test(k) && typeof window[k] === "function");
    // Find element on artboard
    const el = document.querySelector(`.tn-elem[data-elem-id="${bid}"]`);
    if (!el) return { err: "element not found" };
    // Click it to select
    el.click();
    return { selected: true, fnsAvailable: tnFns.filter(f => /effect|hover|setField|updateField|setHover/i.test(f)).slice(0, 30) };
  }, buttonId);
  console.log("  select:", result);

  // Look at element's current field representation in tn
  const fields = await page.evaluate((bid) => {
    // Try common patterns to read element by id
    let elem = null;
    if (window.tnzb__getElemById) elem = window.tnzb__getElemById(bid);
    if (!elem && window.tn?.zb?.getElemById) elem = window.tn.zb.getElemById(bid);
    if (!elem) {
      const all = Object.keys(window).filter(k => k.includes("tn") || k.includes("Tn"));
      return { err: "no getter found", candidates: all.slice(0, 20) };
    }
    return { keys: Object.keys(elem).slice(0, 50), sample: JSON.parse(JSON.stringify(elem)).toString?.().slice(0, 200) };
  }, buttonId);
  console.log("  element fields:", JSON.stringify(fields, null, 2)?.slice(0, 800));

  // Probably we need to dispatch a UI event. Easier path — manipulate panel inputs.
  // Open Settings panel:
  console.log("[3] click Settings (tn-panel-trigger_settings) to open right panel");
  try {
    const triggers = await page.locator('.tn-panel-trigger_settings').count();
    console.log(`  settings triggers: ${triggers}`);
    if (triggers > 0) {
      await page.locator('.tn-panel-trigger_settings').first().click({ timeout: 3000 });
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch {}

  // Find any color-picker / input related to hover
  console.log("[4] enumerate visible inputs after Settings opens");
  const visibleInputs = await page.evaluate(() => {
    return [...document.querySelectorAll('input, textarea, select')]
      .filter(el => el.getBoundingClientRect().width > 0)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        name: el.name || "",
        type: el.type || "",
        id: el.id || "",
        placeholder: el.placeholder || "",
        cls: (el.className || "").toString().slice(0, 80),
        value: (el.value || "").slice(0, 30),
      }))
      .filter(i => /hover|state|effect|behavior/i.test(i.name + i.id + i.cls + i.placeholder))
      .slice(0, 25);
  });
  console.log("  hover-related inputs:", visibleInputs.length);
  visibleInputs.forEach(i => console.log(`    name=${i.name} id=${i.id} cls=${i.cls.slice(0, 50)}`));

  // Press Ctrl+S to force save and capture current code structure
  console.log("[5] Ctrl+S to capture current state");
  await page.keyboard.press("Control+S");
  await new Promise(r => setTimeout(r, 4000));

  console.log(`\n[6] /zero/submit/ saves captured: ${zeroSaves.length}`);
  zeroSaves.forEach((z, i) => {
    console.log(`  [${i}] status=${z.status} body=${z.body.slice(0, 80)}`);
    // Print code's button element keys
    try {
      const code = JSON.parse(z.code);
      const button = Object.values(code).find(e => e && typeof e === "object" && e.elem_type === "button");
      if (button) {
        console.log(`    button keys: ${Object.keys(button).join(", ")}`);
        // Print hover/effect related entries
        Object.entries(button).filter(([k]) => /hover|effect|state/i.test(k)).forEach(([k, v]) => {
          console.log(`    ${k} = ${typeof v === "object" ? JSON.stringify(v).slice(0, 100) : String(v).slice(0, 80)}`);
        });
      }
    } catch (e) { console.log(`    code parse err: ${e.message.slice(0, 60)}`); }
  });

  writeFileSync(join(OUT_DIR, "explore28_zerosaves.json"), JSON.stringify(zeroSaves, null, 2));

  // Delete via MCP — simpler than direct
  const child2 = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  child2.stderr.on("data", () => {});
  await new Promise(r => setTimeout(r, 1000));
  child2.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "0" } } }) + "\n");
  await new Promise(r => setTimeout(r, 500));
  child2.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "delete_page", arguments: { pageid: pageId } } }) + "\n");
  await new Promise(r => setTimeout(r, 5000));
  child2.kill();

  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
