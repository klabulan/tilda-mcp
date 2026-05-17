#!/usr/bin/env node
// Smoke-2: full page lifecycle through MCP — create → settings → add_block → publish → delete.
// Also cleans up all `smoke-*` / "Blank page" / "smoke-renamed-*" pages left from earlier tests.

import { spawn } from "node:child_process";
import { join } from "node:path";

const SERVER = join(process.cwd(), "dist/index.js");
const PROJECT_ID = "25668306";

function sendMcp(child, id, method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
}

async function main() {
  const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  child.stderr.on("data", (d) => process.stderr.write(`[srv] ${d}`));
  const responses = new Map();
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      try { const m = JSON.parse(line); if (m.id) responses.set(m.id, m); } catch {}
    }
  });
  async function call(method, params, timeoutMs = 30_000) {
    const id = Math.floor(Math.random() * 1e9);
    sendMcp(child, id, method, params);
    const start = Date.now();
    while (!responses.has(id) && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 100));
    const r = responses.get(id);
    if (!r) throw new Error(`timeout ${method}`);
    if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`);
    return r.result;
  }

  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke2", version: "0" } });

  // --- Step 1: create ---
  console.log("\n[1] create_page");
  const created = JSON.parse((await call("tools/call", {
    name: "create_page",
    arguments: { projectid: PROJECT_ID, title: "smoke2-life", alias: "smoke2-life" }
  })).content[0].text);
  const pageId = created.page_id;
  console.log(`  page_id=${pageId}`);

  // --- Step 2: set settings ---
  console.log("\n[2] set_page_settings (title + alias)");
  const ts = Date.now();
  const newAlias = `smoke2-life-${ts}`;
  const settings = JSON.parse((await call("tools/call", {
    name: "set_page_settings",
    arguments: { pageid: pageId, title: `Smoke2 Life ${ts}`, descr: "smoke2 test page", alias: newAlias }
  })).content[0].text);
  console.log(`  ${JSON.stringify(settings)}`);

  // --- Step 3: add block ---
  console.log("\n[3] add_block T396");
  const block = JSON.parse((await call("tools/call", {
    name: "add_block",
    arguments: { pageid: pageId, block_type: "T396", position: null }
  })).content[0].text);
  console.log(`  block_id=${block.block_id}`);

  // --- Step 4: publish ---
  console.log("\n[4] publish");
  const pub = JSON.parse((await call("tools/call", {
    name: "publish",
    arguments: { pageid: pageId }
  }, 60_000)).content[0].text);
  console.log(`  ${pub.published_url}`);

  // --- Step 5: verify alias URL (may need a republish to pick up alias filename) ---
  console.log("\n[5] verify URL responds");
  // The published URL above may be pageNNN.html until alias propagates.
  // Try both: alias URL and pageNNN.html
  const tryUrls = [
    `https://wildly-golden-fulmar.tilda.ws/${newAlias}.html`,
    pub.published_url,
  ];
  for (const url of tryUrls) {
    const r = await fetch(url, { method: "HEAD" });
    console.log(`  HEAD ${url}: ${r.status}`);
  }

  // --- Step 6: cleanup — delete this and all leftover smoke pages ---
  console.log("\n[6] cleanup: delete all smoke-* pages");
  // Use read-API getpageslist to list and pick targets
  const pl = JSON.parse((await call("tools/call", {
    name: "get_pages",
    arguments: { projectid: PROJECT_ID }
  })).content[0].text);
  const pages = pl?.result ?? pl;  // shape: list
  const targets = (Array.isArray(pages) ? pages : []).filter((p) =>
    /^(Blank page|smoke|smoke-renamed|smoke2|Smoke2)/i.test(p.title || "") ||
    /^smoke/i.test(p.alias || "")
  );
  console.log(`  delete candidates: ${targets.length}`);
  for (const t of targets) {
    try {
      const r = JSON.parse((await call("tools/call", {
        name: "delete_page",
        arguments: { pageid: t.id }
      })).content[0].text);
      console.log(`  deleted ${t.id} (${t.title}) → ${r.success ? "OK" : "FAIL"}`);
    } catch (e) {
      console.log(`  delete ${t.id} FAIL: ${e.message.substring(0, 100)}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  // Final check
  const pl2 = JSON.parse((await call("tools/call", {
    name: "get_pages",
    arguments: { projectid: PROJECT_ID }
  })).content[0].text);
  const pages2 = pl2?.result ?? pl2;
  console.log(`\n[7] final pages: ${Array.isArray(pages2) ? pages2.length : "?"} remain`);
  if (Array.isArray(pages2)) pages2.forEach(p => console.log(`  ${p.id} | ${p.title} | alias=${p.alias}`));

  child.kill();
  console.log("\n=== smoke2 PASSED ===");
}
main().catch((e) => { console.error("\n!! smoke2 FAILED:", e.message); process.exit(1); });
