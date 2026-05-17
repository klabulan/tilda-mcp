#!/usr/bin/env node
// Explore 7e: call window.td__delPage(pageid) directly via page.evaluate, override confirm() first.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const VICTIM = process.env.VICTIM_PAGE_ID ?? "142150426";

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
  await page.waitForSelector('text="Настройки"', { timeout: 60_000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) {
    await page.keyboard.press("Escape");
    await new Promise(r => setTimeout(r, 800));
  }

  // Override confirm() to always return true so td__delPage doesn't abort
  await page.evaluate(() => {
    window.confirm = () => true;
    // also intercept Tilda's tc-custom-dialog confirm if any
  });

  console.log("[2] inspect td__delPage signature");
  const sig = await page.evaluate(() => {
    if (typeof window.td__delPage === "function") {
      return { exists: true, src: window.td__delPage.toString().slice(0, 400) };
    }
    return { exists: false };
  });
  console.log("  td__delPage:", sig);

  console.log("[3] call window.td__delPage(VICTIM)");
  const preDel = network.length;
  const res = await page.evaluate((id) => {
    try {
      const r = window.td__delPage(id);
      return { ok: true, ret: String(r).slice(0, 200) };
    } catch (e) {
      return { ok: false, err: String(e).slice(0, 200) };
    }
  }, VICTIM);
  console.log("  call result:", res);
  await new Promise(r => setTimeout(r, 6000));

  console.log("[4] post-delete network:");
  network.slice(preDel).forEach((n, i) => {
    if (n.phase === "req" && (n.method !== "GET" || n.url.match(/delete|del-page|deletepage|delpage|pagedel/i))) {
      console.log(`  [${preDel + i}] REQ ${n.method} ${n.url}`);
      if (n.postData) console.log(`        body: ${n.postData.substring(0, 300)}`);
    }
    if (n.phase === "res" && n.url.match(/submit|delete|del-page|deletepage|delpage|pagedel/i)) {
      console.log(`  [${preDel + i}] RES ${n.status} ${n.url}`);
      if (n.body) console.log(`        body: ${n.body.substring(0, 200).replace(/\n/g, " ")}`);
    }
  });

  writeFileSync(join(OUT_DIR, "explore7e_network.json"), JSON.stringify(network, null, 2));
  await context.close(); await browser.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
