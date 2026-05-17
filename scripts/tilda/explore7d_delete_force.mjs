#!/usr/bin/env node
// Explore 7d: force-click .js-pg-del-page OR call delete via JS function probe.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const VICTIM = process.env.VICTIM_PAGE_ID ?? "142150426";

async function jitter(min, max) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }
async function dump(page, label) {
  const safe = label.replace(/[^a-z0-9_-]/gi, "_");
  await page.screenshot({ path: join(OUT_DIR, `${safe}.png`), fullPage: true }).catch(() => {});
  writeFileSync(join(OUT_DIR, `${safe}.html`), await page.content().catch(() => "<error>"));
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US", timezoneId: "Europe/Berlin", storageState: STATE_PATH,
  });
  const network = [];
  context.on("request", (req) => {
    const u = req.url();
    if (!u.match(/tilda\.(cc|ru)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico)\b/)) return;
    network.push({ phase: "req", method: req.method(), url: u, postData: req.postData() });
  });
  context.on("response", async (res) => {
    const req = res.request();
    const u = req.url();
    if (!u.match(/tilda\.(cc|ru)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico)\b/)) return;
    let body = null;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("json") || ct.includes("text") || ct.includes("javascript")) {
        body = (await res.body()).toString("utf8").slice(0, 1200);
      }
    } catch {}
    network.push({ phase: "res", url: u, status: res.status(), body });
  });

  const page = await context.newPage();
  page.on("dialog", async (d) => { console.log(`  DIALOG: ${d.message().substring(0, 100)}`); await d.accept(); });

  console.log(`[1] open editor for ${VICTIM}`);
  await page.goto(`https://tilda.ru/page/?pageid=${VICTIM}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  // Wait until Tilda's "Настройки" appears (signals editor chrome rendered)
  await page.waitForSelector('text="Настройки"', { timeout: 60_000 }).catch(() => {});
  await jitter(2000, 3500);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) {
    await page.keyboard.press("Escape");
    await jitter(500, 1000);
  }
  await dump(page, "70b_editor_loaded");

  console.log("[2] open Настройки");
  await page.getByText("Настройки", { exact: true }).first().click({ timeout: 30_000 });
  await jitter(2500, 4000);

  console.log("[2b] switch to 'Действия' tab");
  try {
    await page.getByText("Действия", { exact: true }).first().click({ timeout: 5000 });
    await jitter(800, 1500);
  } catch (e) {
    console.log(`  'Действия' tab not clickable: ${e.message.substring(0, 100)}`);
  }
  await dump(page, "74b_actions_tab");

  // Look for tabs in the popup
  console.log("[3] probe popup tabs (Главное / SEO / Удалить / ...)");
  const tabs = await page.evaluate(() => {
    const out = [];
    const tabsel = ['.td-popup__tabs', '.td-popup-window__tabs', '.popup-ps__tabs', '.td-tab', '.nav-tabs'];
    for (const root of tabsel) {
      document.querySelectorAll(`${root} li, ${root} a, ${root} button`).forEach(el => {
        const t = (el.innerText || el.textContent || '').trim();
        if (t && t.length < 50) out.push({ root, text: t, cls: (el.className || '').toString().slice(0, 80) });
      });
    }
    return out;
  });
  console.log("  tabs:", JSON.stringify(tabs, null, 2));

  // Find global delete fns
  console.log("[4] probe global JS delete functions");
  const fns = await page.evaluate(() => {
    const out = [];
    for (const k of Object.keys(window)) {
      try {
        if (typeof (window)[k] === "function" && /del(ete)?.*page|page.*del/i.test(k)) {
          out.push(k);
        }
      } catch {}
    }
    return out;
  });
  console.log("  delete-related fns:", fns);

  // Try force-click the hidden link — this fires the bound JS handler regardless of visibility
  console.log("[5] force-click .js-pg-del-page");
  const preDel = network.length;
  try {
    await page.locator('a.js-pg-del-page').first().click({ force: true, timeout: 5000 });
    console.log("  forced click OK");
  } catch (e) {
    console.log(`  force click failed: ${e.message.substring(0,100)}`);
  }
  await jitter(4000, 6000);
  await dump(page, "75_after_force_delete");

  console.log("[6] post-delete network:");
  network.slice(preDel).forEach((n, i) => {
    if (n.phase === "req" && (n.method !== "GET" || n.url.match(/delete|pagedel|del-page/i))) {
      console.log(`  [${preDel + i}] REQ ${n.method} ${n.url}`);
      if (n.postData) console.log(`        body: ${n.postData.substring(0, 300)}`);
    }
    if (n.phase === "res" && n.url.match(/submit|delete|del-page|pagedel/i)) {
      console.log(`  [${preDel + i}] RES ${n.status} ${n.url}`);
      if (n.body) console.log(`        body: ${n.body.substring(0, 200).replace(/\n/g, " ")}`);
    }
  });

  writeFileSync(join(OUT_DIR, "explore7d_network.json"), JSON.stringify(network, null, 2));
  await context.close(); await browser.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
