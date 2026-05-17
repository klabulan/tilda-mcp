#!/usr/bin/env node
// 10× sequential add_block→publish cycle to verify no CAPTCHA / no lockout / no session expiry.
// Uses the page created in the basic smoke; if none, creates one.

import { spawn } from "node:child_process";
import { join } from "node:path";

const SERVER = join(process.cwd(), "dist/index.js");
const PROJECT_ID = "25668306";

function sendMcp(child, id, method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
}

async function main() {
  const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  child.stderr.on("data", () => { /* silenced */ });
  const responses = new Map();
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      try { const msg = JSON.parse(line); if (msg.id) responses.set(msg.id, msg); } catch {}
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

  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke10", version: "0" } });

  // create one fresh page for the run
  const cp = await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke10", alias: null } });
  const pageId = JSON.parse(cp.content[0].text).page_id;
  console.log(`base page: ${pageId}`);

  const results = [];
  for (let i = 1; i <= 10; i++) {
    const t0 = Date.now();
    let ok = true, err = null;
    try {
      const ab = await call("tools/call", { name: "add_block", arguments: { pageid: pageId, block_type: "T396", position: null } }, 30_000);
      const block = JSON.parse(ab.content[0].text).block_id;
      const pub = await call("tools/call", { name: "publish", arguments: { pageid: pageId } }, 60_000);
      const url = JSON.parse(pub.content[0].text).published_url;
      const dt = Date.now() - t0;
      console.log(`  run ${i}/10: block=${block} → ${url} (${dt}ms)`);
      results.push({ run: i, ok: true, ms: dt, block, url });
      // small inter-run spacing
      await new Promise(r => setTimeout(r, 5000 + Math.random() * 10_000));
    } catch (e) {
      ok = false; err = e.message;
      console.error(`  run ${i}/10 FAIL: ${e.message}`);
      results.push({ run: i, ok: false, err });
    }
  }
  child.kill();

  const passed = results.filter(r => r.ok).length;
  const avgMs = Math.round(results.filter(r => r.ok).reduce((s, r) => s + r.ms, 0) / Math.max(passed, 1));
  console.log(`\n=== 10-run summary ===`);
  console.log(`  passed: ${passed}/10`);
  console.log(`  avg wall-clock per cycle: ${avgMs}ms`);
  if (passed !== 10) {
    console.error("!! NOT all 10 runs passed");
    process.exit(1);
  }
  console.log("=== 10-run STABILITY PASSED ===");
}
main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
