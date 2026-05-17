#!/usr/bin/env node
// Explore step 7: capture page settings (title/alias/SEO) save XHR + delete-page XHR.
// Uses one of our smoke pages as victim.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PROJECT_ID = "25668306";

async function jitter(min = 400, max = 1200) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }
async function dump(page, label) {
  const safe = label.replace(/[^a-z0-9_-]/gi, "_");
  await page.screenshot({ path: join(OUT_DIR, `${safe}.png`), fullPage: true }).catch(() => {});
  writeFileSync(join(OUT_DIR, `${safe}.html`), await page.content().catch(() => "<error>"));
}

function printNet(network, fromIdx) {
  network.slice(fromIdx).forEach((n, i) => {
    if (n.phase === "req" && (n.method !== "GET" || n.url.match(/submit|publish|delete/i))) {
      console.log(`  [${fromIdx + i}] REQ ${n.method} ${n.url}`);
      if (n.postData) console.log(`        body: ${n.postData.substring(0, 400)}`);
    }
    if (n.phase === "res" && n.url.match(/submit|publish|delete/i)) {
      console.log(`  [${fromIdx + i}] RES ${n.status} ${n.url}`);
      if (n.body) console.log(`        body: ${n.body.substring(0, 400).replace(/\n/g, " ")}`);
    }
  });
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
    network.push({ phase: "req", ts: Date.now(), method: req.method(), url: u, postData: req.postData() });
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
        body = (await res.body()).toString("utf8").slice(0, 1500);
      }
    } catch {}
    network.push({ phase: "res", ts: Date.now(), url: u, status: res.status(), body });
  });

  const page = await context.newPage();

  // --- PART A: page settings ---
  // We need a page to play with. Get pages list and pick first.
  console.log("[A0] open project view to find a page id");
  await page.goto(`https://tilda.ru/projects/?projectid=${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await jitter(2000, 3000);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) {
    await page.keyboard.press("Escape");
    await jitter(500, 1000);
  }
  await dump(page, "60_project_with_pages");

  // Find page tiles
  const pageIdAttr = await page.locator('[data-page-id]').first().getAttribute("data-page-id").catch(() => null);
  console.log(`  first page-id from DOM: ${pageIdAttr}`);

  // Use one of our smoke pages by id. We have them; pick the first one (142150236).
  const TEST_PAGE_ID = "142150236";

  // Now open page editor for it
  console.log(`[A1] open page editor for ${TEST_PAGE_ID}`);
  await page.goto(`https://tilda.ru/page/?pageid=${TEST_PAGE_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) {
    await page.keyboard.press("Escape");
    await jitter(500, 1000);
  }
  await dump(page, "61_editor_ready");

  console.log("[A2] click Настройки (page settings)");
  const preSettings = network.length;
  const settingsBtn = page.getByText("Настройки", { exact: true });
  if (await settingsBtn.count() === 0) {
    console.log("  Settings not visible — try .td-toolbar__settings");
  }
  try {
    await settingsBtn.first().click({ timeout: 8000 });
    await jitter(2000, 4000);
  } catch (e) {
    console.log(`  Settings click fail: ${e.message.substring(0, 120)}`);
  }
  await dump(page, "62_settings_popup");

  // --- locate title + alias inputs in popup ---
  console.log("[A3] inspect settings popup inputs");
  const probe = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[type="text"], input:not([type]), textarea')];
    return inputs.slice(0, 30).map(el => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      name: el.name || '',
      id: el.id || '',
      placeholder: el.placeholder || '',
      cls: el.className || '',
      value: (el.value || '').substring(0, 50),
      visible: el.offsetWidth > 0 && el.offsetHeight > 0,
    }));
  });
  console.log("  visible inputs in settings popup:");
  probe.filter(p => p.visible).slice(0, 15).forEach(p => console.log(`    name="${p.name}" id="${p.id}" placeholder="${p.placeholder}" value="${p.value}"`));

  // Fill title + alias
  const NEW_TITLE = `smoke-renamed-${Date.now()}`;
  const NEW_ALIAS = `smoke-renamed-${Date.now()}`;

  console.log("[A4] try to fill title + alias");
  const titleSels = ['input[name="title"]', 'input[name="pagetitle"]', '#page_title', '#title'];
  for (const s of titleSels) if (await page.locator(s).count()) { await page.locator(s).first().fill(NEW_TITLE).catch(() => {}); console.log(`  title -> ${s}`); break; }
  const aliasSels = ['input[name="alias"]', 'input[name="filename"]', '#page_filename', '#filename'];
  for (const s of aliasSels) if (await page.locator(s).count()) { await page.locator(s).first().fill(NEW_ALIAS).catch(() => {}); console.log(`  alias -> ${s}`); break; }
  await jitter(500, 1000);

  // Find Save / Применить / Сохранить button
  console.log("[A5] click Save");
  const saveSels = [
    'input.js-ps-popup-submit',
    'input.td-popup-btn.js-ps-popup-submit',
    'input[value="Сохранить изменения"]',
    'button:has-text("Применить")', 'button:has-text("Сохранить")', 'button:has-text("Save")',
    '.td-popup__submit', '.td-form__submit', '.td-popup-window button[type="submit"]',
    '.tp-modal__button_primary',
  ];
  let saved = false;
  for (const s of saveSels) {
    if (await page.locator(s).count()) {
      try { await page.locator(s).first().click({ timeout: 5000 }); console.log(`  saved -> ${s}`); saved = true; break; } catch {}
    }
  }
  await jitter(3000, 5000);
  await dump(page, "63_after_settings_save");

  console.log("[A6] post-settings-save network:");
  printNet(network, preSettings);

  // --- PART B: delete page ---
  // Strategy: go back to project page list, find delete UI on a smoke page.
  // We'll delete a different page (142150266 or similar) — pick one from list.
  console.log("\n[B1] back to project view");
  await page.goto(`https://tilda.ru/projects/?projectid=${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await jitter(2000, 3000);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) {
    await page.keyboard.press("Escape");
    await jitter(500, 1000);
  }
  await dump(page, "64_project_for_delete");

  // Probe page tile structure — find delete trigger
  console.log("[B2] inspect page tiles for delete affordance");
  const tiles = await page.evaluate(() => {
    const out = [];
    const cards = [...document.querySelectorAll('[data-page-id]')];
    cards.slice(0, 5).forEach(c => {
      const id = c.getAttribute('data-page-id');
      // gather onclick handlers, classes inside the card
      const onclicks = [...c.querySelectorAll('[onclick]')].map(el => ({
        oc: el.getAttribute('onclick').slice(0, 120),
        cls: el.className.toString().slice(0, 80),
      }));
      out.push({ id, onclicks: onclicks.slice(0, 10) });
    });
    return out;
  });
  tiles.forEach(t => {
    console.log(`  page ${t.id}:`);
    t.onclicks.forEach(o => console.log(`    ${o.oc} (${o.cls})`));
  });

  // Save and exit. Real delete-click and capture is the second pass.
  writeFileSync(join(OUT_DIR, "explore7_network.json"), JSON.stringify(network, null, 2));
  await context.close(); await browser.close();
  console.log(`[done] network saved (${network.length} entries)`);
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
