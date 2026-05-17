#!/usr/bin/env node
// Smoke test: drive fork MCP via stdio + verify each tool against Tilda Export API.

import { spawn } from "node:child_process";
import { join } from "node:path";

const SERVER = join(process.cwd(), "dist/index.js");
const PROJECT_ID = "25668306";

function sendMcp(child, id, method, params) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  child.stdin.write(msg);
}

async function main() {
  const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });

  child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  const responses = new Map();
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id) responses.set(msg.id, msg);
      } catch (e) {
        console.error("[parse fail]", line);
      }
    }
  });

  async function call(method, params, timeoutMs = 30_000) {
    const id = Math.floor(Math.random() * 1e9);
    sendMcp(child, id, method, params);
    const start = Date.now();
    while (!responses.has(id) && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const r = responses.get(id);
    if (!r) throw new Error(`timeout waiting for ${method} (id=${id})`);
    if (r.error) throw new Error(`${method} error: ${JSON.stringify(r.error)}`);
    return r.result;
  }

  // initialize
  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
  console.log("\n=== initialized ===");

  // list tools
  const tools = await call("tools/list", {});
  console.log(`tools listed: ${tools.tools.length}`);
  const names = tools.tools.map(t => t.name);
  console.log("  " + names.join(", "));
  if (names.length !== 16) {
    console.error(`!! expected 16 tools, got ${names.length}`);
    child.kill(); process.exit(1);
  }

  // health_check
  console.log("\n=== health_check ===");
  const health = await call("tools/call", { name: "health_check", arguments: {} });
  console.log(health.content[0].text);

  // create_page
  console.log("\n=== create_page ===");
  const cp = await call("tools/call", { name: "create_page", arguments: { projectid: PROJECT_ID, title: "smoke-test", alias: null } });
  console.log(cp.content[0].text);
  const created = JSON.parse(cp.content[0].text);
  const PAGE_ID = created.page_id;
  console.log(`  pageid=${PAGE_ID}`);

  // add_block (Zero Block T396)
  console.log("\n=== add_block T396 ===");
  const ab = await call("tools/call", { name: "add_block", arguments: { pageid: PAGE_ID, block_type: "T396", position: null } });
  console.log(ab.content[0].text);

  // publish
  console.log("\n=== publish ===");
  const pub = await call("tools/call", { name: "publish", arguments: { pageid: PAGE_ID } }, 60_000);
  console.log(pub.content[0].text);
  const published = JSON.parse(pub.content[0].text);

  // Verify by fetching the URL (Tilda CDN may take a few seconds to propagate)
  console.log("\n=== verify published URL ===");
  let status = 0;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const verifyRes = await fetch(published.published_url, { method: "HEAD" });
    status = verifyRes.status;
    console.log(`  attempt ${i + 1}: ${status} ${verifyRes.statusText}`);
    if (status === 200) break;
  }
  child.kill();
  if (status !== 200) {
    console.error(`!! published_url did not return 200 after 30s: ${published.published_url}`);
    process.exit(1);
  }
  console.log("\n=== smoke PASSED ===");
}

main().catch((e) => { console.error("\n!! smoke FAILED:", e.message); process.exit(1); });
