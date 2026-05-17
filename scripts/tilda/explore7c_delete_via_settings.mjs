#!/usr/bin/env node
// Explore 7c: capture delete via page settings popup → .js-pg-del-page → confirm

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
  page.on("dialog", async (d) => {
    console.log(`  DIALOG (${d.type()}): "${d.message().substring(0, 120)}" → accept`);
    await d.accept();
  });

  console.log(`[1] open editor for ${VICTIM}`);
  await page.goto(`https://tilda.ru/page/?pageid=${VICTIM}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await jitter(2500, 4000);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) {
    await page.keyboard.press("Escape");
    await jitter(500, 1000);
  }

  console.log("[2] open page settings (Настройки)");
  await page.getByText("Настройки", { exact: true }).first().click({ timeout: 8000 });
  await jitter(2000, 3500);
  await dump(page, "73_settings_open");

  console.log("[3] click .js-pg-del-page");
  const preDel = network.length;
  const del = page.locator('a.js-pg-del-page');
  const dc = await del.count();
  console.log(`  js-pg-del-page count: ${dc}`);
  await del.first().click({ timeout: 5000 });
  await jitter(4000, 6000);
  await dump(page, "74_after_delete_click");

  console.log("[4] post-delete network:");
  network.slice(preDel).forEach((n, i) => {
    if (n.phase === "req" && (n.method !== "GET" || n.url.match(/delete|pagedel|del-page|deletepage/i))) {
      console.log(`  [${preDel + i}] REQ ${n.method} ${n.url}`);
      if (n.postData) console.log(`        body: ${n.postData.substring(0, 300)}`);
    }
    if (n.phase === "res" && (n.url.match(/submit|delete|del-page|pagedel/i))) {
      console.log(`  [${preDel + i}] RES ${n.status} ${n.url}`);
      if (n.body) console.log(`        body: ${n.body.substring(0, 200).replace(/\n/g, " ")}`);
    }
  });

  writeFileSync(join(OUT_DIR, "explore7c_network.json"), JSON.stringify(network, null, 2));
  await context.close(); await browser.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
