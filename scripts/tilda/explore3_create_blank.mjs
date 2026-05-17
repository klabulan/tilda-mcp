#!/usr/bin/env node
// Explore step 3: click Add Page → pick Blank template (data-page-id=1231) → capture create XHR.
import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = process.env.TILDA_MCP_STATE_PATH ?? join(homedir(), ".config/tilda-mcp/state.json");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PROJECT_ID = "25668306";
const HEADED = process.env.HEADED !== "0";

async function jitter(min = 400, max = 1200) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }
async function dump(page, label) {
  const safe = label.replace(/[^a-z0-9_-]/gi, "_");
  await page.screenshot({ path: join(OUT_DIR, `${safe}.png`), fullPage: true }).catch(() => {});
  writeFileSync(join(OUT_DIR, `${safe}.html`), await page.content().catch(() => "<error>"));
}

async function main() {
  const browser = await chromium.launch({
    headless: !HEADED,
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
    if (!req.url().match(/tilda\.(cc|ru)/)) return;
    if (req.url().match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico)\b/)) return;
    network.push({ phase: "req", ts: Date.now(), method: req.method(), url: req.url(), postData: req.postData() });
  });
  context.on("response", async (res) => {
    const req = res.request();
    if (!req.url().match(/tilda\.(cc|ru)/)) return;
    if (req.url().match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico)\b/)) return;
    let body = null;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("json") || ct.includes("text") || ct.includes("javascript")) {
        body = (await res.body()).toString("utf8").slice(0, 4000);
      }
    } catch {}
    network.push({ phase: "res", ts: Date.now(), url: req.url(), status: res.status(), body });
  });

  const page = await context.newPage();
  console.log("[1] open project");
  await page.goto(`https://tilda.ru/projects/?projectid=${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await jitter(2500, 3500);
  await dump(page, "19_project_view_loaded");

  console.log("[2a] wait for project view to render");
  await page.locator(".td-button-addnewpage").waitFor({ state: "visible", timeout: 30_000 });
  await jitter(1500, 2500);
  await dump(page, "19b_before_alert_check");

  // --- Close any alert-dialog (Tilda onboarding/notification overlays) ---
  const alert = page.locator('#alert-dialog.td-popup_opened');
  if (await alert.count() > 0) {
    console.log("[2b] alert-dialog visible — attempting close");
    await dump(page, "19c_alert_visible");
    const closeCandidates = [
      '#alert-dialog .tc-custom-dialog__close',
      '#alert-dialog .td-popup__close',
      '#alert-dialog button:has-text("OK")',
      '#alert-dialog button:has-text("Ок")',
      '#alert-dialog button:has-text("Понятно")',
      '#alert-dialog button:has-text("Continue")',
      '#alert-dialog button:has-text("Close")',
      '#alert-dialog .tc-custom-dialog__button',
      '#alert-dialog .tc-alert-dialog__button',
      '#alert-dialog button',
    ];
    let closed = false;
    for (const s of closeCandidates) {
      if (await page.locator(s).count()) {
        try {
          await page.locator(s).first().click({ timeout: 3000 });
          console.log(`  closed via ${s}`);
          closed = true;
          break;
        } catch (e) {
          console.log(`  ${s} click failed: ${e.message.substring(0, 80)}`);
        }
      }
    }
    if (!closed) {
      // Fallback: press Escape
      console.log("  press Escape");
      await page.keyboard.press("Escape");
    }
    await jitter(500, 1500);
  }

  console.log("[2c] click Add page");
  await page.locator(".td-button-addnewpage").first().click({ timeout: 15_000 });
  await jitter(1500, 2500);
  await dump(page, "20_template_popup");

  console.log("[3] dump network so far (pre-template-click)");
  const preCount = network.length;
  console.log(`  network entries before: ${preCount}`);

  console.log("[4] click Blank template (data-page-id=1231)");
  // The clickable div is the inner one with onclick="dw__createnew('1231')"
  const blank = page.locator('[data-page-id="1231"][data-page-alias="blank"] div[onclick*="dw__createnew"]');
  const bc = await blank.count();
  console.log(`  blank-click count: ${bc}`);
  if (bc === 0) {
    // fallback to the table-row container
    await page.locator('[data-page-id="1231"][data-page-alias="blank"]').first().click({ timeout: 5000 });
  } else {
    await blank.first().click({ timeout: 5000 });
  }
  await jitter(4000, 6000);
  await dump(page, "21_after_blank_click");

  console.log("[5] post-click network entries:");
  const newEntries = network.slice(preCount);
  newEntries.forEach((n, i) => {
    if (n.phase === "req") {
      console.log(`  [${i}] REQ ${n.method} ${n.url}`);
      if (n.postData) console.log(`        body: ${n.postData.substring(0, 300)}`);
    } else {
      console.log(`  [${i}] RES ${n.status} ${n.url}`);
      if (n.body && n.body.length < 800) console.log(`        body: ${n.body.substring(0, 500).replace(/\n/g, " ")}`);
    }
  });

  writeFileSync(join(OUT_DIR, "explore3_network.json"), JSON.stringify(network, null, 2));
  console.log(`[done] saved network (${network.length} entries) → explore3_network.json`);
  await context.close();
  await browser.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
