#!/usr/bin/env node
// Explore step 5: click ZERO bottom-panel button → add Zero Block → publish; capture XHRs for both.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PAGE_ID = process.env.PAGE_ID ?? "142150236";

async function jitter(min = 400, max = 1200) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }
async function dump(page, label) {
  const safe = label.replace(/[^a-z0-9_-]/gi, "_");
  await page.screenshot({ path: join(OUT_DIR, `${safe}.png`), fullPage: true }).catch(() => {});
  writeFileSync(join(OUT_DIR, `${safe}.html`), await page.content().catch(() => "<error>"));
}

function printNetwork(slice, fromIdx) {
  slice.forEach((n, i) => {
    if (n.phase === "req") {
      console.log(`  [${fromIdx + i}] REQ ${n.method} ${n.url}`);
      if (n.postData) console.log(`       body: ${n.postData.substring(0, 300)}`);
    } else if (n.status >= 400 || (n.body && n.body.length < 400)) {
      console.log(`  [${fromIdx + i}] RES ${n.status} ${n.url}`);
      if (n.body) console.log(`       body: ${n.body.substring(0, 300).replace(/\n/g, " ")}`);
    }
  });
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "Europe/Berlin",
    storageState: STATE_PATH,
  });

  const network = [];
  context.on("request", (req) => {
    const u = req.url();
    if (!u.match(/tilda\.(cc|ru|cdn)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico)\b/)) return;
    network.push({ phase: "req", ts: Date.now(), method: req.method(), url: u, postData: req.postData() });
  });
  context.on("response", async (res) => {
    const req = res.request();
    const u = req.url();
    if (!u.match(/tilda\.(cc|ru|cdn)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico)\b/)) return;
    let body = null;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("json") || ct.includes("text") || ct.includes("javascript")) {
        body = (await res.body()).toString("utf8").slice(0, 1500);
      }
    } catch {}
    network.push({ phase: "res", ts: Date.now(), url: u, status: res.status(), body });
  });

  const page = await context.newPage();
  console.log(`[1] open editor`);
  await page.goto(`https://tilda.ru/page/?pageid=${PAGE_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);

  // Close any modal first
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) {
    await page.keyboard.press("Escape");
    await jitter(500, 1000);
  }

  await dump(page, "40_editor_ready");

  // --- STEP A: probe key text-based selectors ---
  console.log("[2] probe text-based selectors");
  const textProbes = ["ZERO", "ВСЕ БЛОКИ", "Опубликовать", "Настройки", "Обложка"];
  for (const txt of textProbes) {
    const c = await page.getByText(txt, { exact: true }).count();
    console.log(`  getByText("${txt}", exact): ${c}`);
  }

  // --- STEP B: click ZERO via [data-tplid="396"] ---
  const preZero = network.length;
  console.log("[3] click data-tplid=396 (Zero Block)");
  const zeroBtn = page.locator('[data-tplid="396"]').first();
  const zc = await zeroBtn.count();
  console.log(`  data-tplid=396 count: ${zc}`);
  await zeroBtn.click({ timeout: 10_000 });
  await jitter(3000, 5000);
  await dump(page, "41_after_zero_click");
  console.log("[3a] post-ZERO network:");
  printNetwork(network.slice(preZero).filter(n => n.phase === "req" && (n.method !== "GET" || n.url.includes("submit") || n.url.includes("page/get"))), preZero);

  // --- STEP C: click Опубликовать ---
  const prePublish = network.length;
  console.log("[4] click Опубликовать");
  try {
    await page.getByText("Опубликовать", { exact: true }).first().click({ timeout: 10_000 });
    await jitter(5000, 8000);
    await dump(page, "42_after_publish_click");
    console.log("[4a] post-Publish network:");
    printNetwork(network.slice(prePublish).filter(n => n.phase === "req" && (n.method !== "GET" || n.url.includes("submit") || n.url.includes("publish"))), prePublish);
  } catch (e) {
    console.log(`  publish click failed: ${e.message.substring(0,120)}`);
    await dump(page, "42_publish_fail");
  }

  console.log("[5] save network");
  writeFileSync(join(OUT_DIR, "explore5_network.json"), JSON.stringify(network, null, 2));
  await context.close();
  await browser.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
