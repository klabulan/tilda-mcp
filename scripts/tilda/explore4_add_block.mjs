#!/usr/bin/env node
// Explore step 4: open page editor, capture add-block XHR.
// Uses page 142150236 (created in step 3).

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
    if (!req.url().match(/tilda\.(cc|ru|cdn)/)) return;
    if (req.url().match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico)\b/)) return;
    network.push({ phase: "req", ts: Date.now(), method: req.method(), url: req.url(), postData: req.postData() });
  });
  context.on("response", async (res) => {
    const req = res.request();
    if (!req.url().match(/tilda\.(cc|ru|cdn)/)) return;
    if (req.url().match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico)\b/)) return;
    let body = null;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("json") || ct.includes("text") || ct.includes("javascript")) {
        body = (await res.body()).toString("utf8").slice(0, 2000);
      }
    } catch {}
    network.push({ phase: "res", ts: Date.now(), url: req.url(), status: res.status(), body });
  });

  const page = await context.newPage();
  console.log(`[1] open editor for page ${PAGE_ID}`);
  await page.goto(`https://tilda.ru/page/?pageid=${PAGE_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);
  await dump(page, "30_editor_view");

  console.log("[2] inspect DOM for add-block triggers");
  // Find common add-block buttons in Tilda editor
  const selectorsToProbe = [
    '.t-controls__addblock', '.t-control__addblock', '#addblock',
    '.td-page-mainpanel__addblock', '.td-button-addblock',
    '[onclick*="addblock" i]', '[onclick*="addNewBlock" i]', '[onclick*="addBlock" i]',
    'button:has-text("Add Block")', 'button:has-text("Добавить блок")',
    '.td-blocks-controls', '.td-pagemainpanel__addblock',
    '[class*="addnewblock" i]',
  ];
  const found = {};
  for (const s of selectorsToProbe) {
    try {
      const n = await page.locator(s).count();
      if (n > 0) found[s] = n;
    } catch {}
  }
  console.log("  candidate add-block selectors:", JSON.stringify(found, null, 2));

  // Dump only the chrome of the editor (likely the side/top panel)
  const html = await page.content();
  writeFileSync(join(OUT_DIR, "30_editor_view_full.html"), html);
  console.log(`  full html: ${html.length} chars`);

  // Search for any onclick with "addnew" in it
  const matches = [...html.matchAll(/onclick="([^"]*[Aa]dd[^"]*)"/g)].slice(0, 30);
  console.log(`  onclick handlers with "Add" (first 30):`);
  matches.forEach((m, i) => console.log(`    [${i}] ${m[1].substring(0, 120)}`));

  console.log("[3] save network");
  writeFileSync(join(OUT_DIR, "explore4_network.json"), JSON.stringify(network, null, 2));
  await context.close();
  await browser.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
