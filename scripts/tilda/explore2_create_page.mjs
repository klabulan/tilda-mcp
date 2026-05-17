#!/usr/bin/env node
// Explore step 2: trigger AddPage popup, fill form, submit, capture XHR.
// Goal: discover the create-page endpoint signature so XHR transport can call it directly.
//
// Uses persisted storageState from step 1 (~/.config/tilda-mcp/state.json).

import { chromium } from "playwright";
import { homedir } from "node:os";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = process.env.TILDA_MCP_STATE_PATH ?? join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = process.env.TILDA_MCP_PROFILE_DIR ?? join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PROJECT_ID = "25668306";
const TEST_PAGE_TITLE = `smoke-${Date.now()}`;
const TEST_PAGE_ALIAS = `smoke-${Date.now()}`;

if (!existsSync(STATE_PATH)) {
  console.error(`State file missing: ${STATE_PATH}. Run explore.mjs first.`);
  process.exit(1);
}

const HEADED = process.env.HEADED !== "0";

async function jitter(min = 400, max = 1200) {
  await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

async function dump(page, label) {
  const safe = label.replace(/[^a-z0-9_-]/gi, "_");
  await page.screenshot({ path: join(OUT_DIR, `${safe}.png`), fullPage: true }).catch(() => {});
  writeFileSync(join(OUT_DIR, `${safe}.html`), await page.content().catch(() => "<error>"));
  console.log(`  dumped ${label}`);
}

async function main() {
  console.log(`[explore2] headed=${HEADED}`);
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !HEADED,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "Europe/Berlin",
  });

  // Capture EVERY request + response that touches tilda.cc/ru, including bodies
  const network = [];
  context.on("request", async (req) => {
    if (!req.url().match(/tilda\.(cc|ru)/)) return;
    let postBody = null;
    try { postBody = req.postData(); } catch {}
    network.push({
      phase: "req",
      ts: Date.now(),
      method: req.method(),
      url: req.url(),
      headers: req.headers(),
      postData: postBody,
      resourceType: req.resourceType(),
    });
  });
  context.on("response", async (res) => {
    const req = res.request();
    if (!req.url().match(/tilda\.(cc|ru)/)) return;
    let body = null;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("json") || ct.includes("text") || ct.includes("javascript")) {
        const buf = await res.body();
        body = buf.toString("utf8").slice(0, 2000);
      }
    } catch {}
    network.push({
      phase: "res",
      ts: Date.now(),
      url: req.url(),
      status: res.status(),
      headers: res.headers(),
      body,
    });
  });

  const page = await context.newPage();

  // --- 1. open project page ---
  console.log("[1] open project view");
  await page.goto(`https://tilda.cc/projects/?projectid=${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
  await jitter(2000, 3000);
  await dump(page, "10_project_view_before_addpage");

  // --- 2. find and click "Add new page" ---
  console.log("[2] click .td-button-addnewpage");
  const addBtn = page.locator(".td-button-addnewpage");
  const addCount = await addBtn.count();
  console.log(`  found ${addCount} addnewpage buttons`);
  if (addCount === 0) {
    await dump(page, "10b_no_add_button");
    writeFileSync(join(OUT_DIR, "explore2_network.json"), JSON.stringify(network, null, 2));
    await context.close();
    process.exit(2);
  }
  await addBtn.first().click({ timeout: 5_000 });
  await jitter(800, 1500);
  await dump(page, "11_addpage_popup");

  // --- 3. inspect popup DOM — find title + alias + submit ---
  console.log("[3] inspect popup");
  // Tilda popups land in #myModal / #popup_createproject / similar. Capture full DOM after popup opens.

  // --- 4. Try fill title field — common labels: "title", "name", "Заголовок", "Title" ---
  const titleSelectors = [
    'input[name="title"]', 'input[name="name"]',
    '#popup_pagesettings input[type="text"]',
    '.td-popup-window input[type="text"]',
    'input.td-popup__field',
  ];
  let titleFilled = false;
  for (const s of titleSelectors) {
    const c = await page.locator(s).count();
    if (c > 0) {
      console.log(`  trying title sel: ${s} (count=${c})`);
      try {
        await page.locator(s).first().fill(TEST_PAGE_TITLE, { timeout: 3000 });
        titleFilled = true;
        console.log(`  title -> ${s}`);
        break;
      } catch (e) {
        console.log(`    failed: ${e.message.substring(0, 80)}`);
      }
    }
  }
  await jitter(400, 800);

  // --- 5. Try alias field ---
  const aliasSelectors = [
    'input[name="alias"]', 'input[name="url"]', 'input[name="slug"]',
    '.td-popup-window input[type="text"]:nth-of-type(2)',
  ];
  for (const s of aliasSelectors) {
    if (await page.locator(s).count()) {
      try {
        await page.locator(s).first().fill(TEST_PAGE_ALIAS, { timeout: 2000 });
        console.log(`  alias -> ${s}`);
        break;
      } catch {}
    }
  }
  await jitter(400, 800);
  await dump(page, "12_addpage_popup_filled");

  // --- 6. Find submit + click ---
  const submitSelectors = [
    'button.td-popup__submit',
    '.td-popup-window button[type="submit"]',
    '.td-popup-window .td-form__submit',
    '.td-popup-window .td-form__inputbtn',
    '.td-popup-window button:has-text("Create")',
    '.td-popup-window button:has-text("Создать")',
    '.td-popup-window input[type="submit"]',
  ];
  console.log("[4] click submit");
  let clicked = false;
  for (const s of submitSelectors) {
    if (await page.locator(s).count()) {
      console.log(`  submit -> ${s}`);
      try {
        await page.locator(s).first().click({ timeout: 3000 });
        clicked = true;
        break;
      } catch (e) {
        console.log(`    failed: ${e.message.substring(0, 80)}`);
      }
    }
  }
  if (!clicked) {
    console.log("  submit selector not found — dumping popup DOM for analysis");
  }
  await jitter(3000, 5000);
  await dump(page, "13_after_submit");

  // --- 7. Try to find the new page id in network ---
  console.log("[5] save network + close");
  writeFileSync(join(OUT_DIR, "explore2_network.json"), JSON.stringify(network, null, 2));
  await context.close();
  console.log(`network entries: ${network.length}`);
  // Print interesting requests right here
  const interesting = network.filter(n => n.phase === "req" && n.method !== "GET" && !n.url.match(/\.(css|png|svg|jpe?g|gif|woff|js)\b/));
  console.log(`  non-GET non-static: ${interesting.length}`);
  interesting.forEach((n, i) => {
    console.log(`  [${i}] ${n.method} ${n.url}`);
    if (n.postData) console.log(`      body: ${n.postData.substring(0, 200)}`);
  });
}

main().catch((e) => {
  console.error("explore2 failed:", e.message);
  process.exit(1);
});
