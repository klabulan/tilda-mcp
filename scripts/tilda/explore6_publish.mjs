#!/usr/bin/env node
// Explore step 6: full publish flow — first-time alias confirm popup → save → real publish XHR.

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

function printReq(network, fromIdx) {
  network.slice(fromIdx).forEach((n, i) => {
    if (n.phase !== "req") return;
    if (n.method === "GET" && !n.url.match(/submit|publish/i)) return;
    console.log(`  [${fromIdx + i}] REQ ${n.method} ${n.url}`);
    if (n.postData) console.log(`        body: ${n.postData.substring(0, 300)}`);
  });
}
function printRes(network, fromIdx) {
  network.slice(fromIdx).forEach((n, i) => {
    if (n.phase !== "res") return;
    if (!n.url.match(/submit|publish/i)) return;
    console.log(`  [${fromIdx + i}] RES ${n.status} ${n.url}`);
    if (n.body) console.log(`        body: ${n.body.substring(0, 300).replace(/\n/g, " ")}`);
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

  // Close intro alert if any
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) {
    await page.keyboard.press("Escape");
    await jitter(500, 1000);
  }

  // --- Click Опубликовать ---
  console.log("[2] click Опубликовать (publish button in navbar)");
  const prePublish = network.length;
  await page.getByText("Опубликовать", { exact: true }).first().click({ timeout: 10_000 });
  await jitter(2000, 3500);
  await dump(page, "50_after_publish_first_click");

  // --- Handle first-time alias confirm popup ---
  const aliasInput = page.locator('.tp-modal__publish-ask input.tp-modal__input, input.tp-modal__input');
  const aliasInputCount = await aliasInput.count();
  console.log(`  alias-input count: ${aliasInputCount}`);
  if (aliasInputCount > 0) {
    console.log("[3] alias-confirm popup detected — accept default (just click Save and continue)");
    const saveBtn = page.locator('.tp-modal__button_primary.tp-modal__button_arrow');
    if (await saveBtn.count() === 0) {
      console.log("  primary-arrow button not found");
      await dump(page, "50b_no_save_button");
    } else {
      await saveBtn.first().click({ timeout: 8_000 });
      await jitter(8000, 12000);   // publish takes seconds
      await dump(page, "51_after_save_continue");
    }
  }

  console.log("[4] post-publish requests:");
  printReq(network, prePublish);
  console.log("[5] post-publish responses (submit/publish only):");
  printRes(network, prePublish);

  writeFileSync(join(OUT_DIR, "explore6_network.json"), JSON.stringify(network, null, 2));
  await context.close();
  await browser.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
