#!/usr/bin/env node
// Explore step 7b: capture page-delete XHR via editor "More" menu.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const VICTIM = process.env.VICTIM_PAGE_ID ?? "142150426"; // safe to delete: smoke page

async function jitter(min = 400, max = 1200) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }
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
        body = (await res.body()).toString("utf8").slice(0, 1500);
      }
    } catch {}
    network.push({ phase: "res", url: u, status: res.status(), body });
  });

  const page = await context.newPage();
  // Set up dialog handler — Tilda will likely confirm() before deleting
  page.on("dialog", async (d) => {
    console.log(`  DIALOG (${d.type()}): ${d.message().substring(0, 150)}`);
    await d.accept();
  });

  console.log(`[1] open editor for victim page ${VICTIM}`);
  await page.goto(`https://tilda.ru/page/?pageid=${VICTIM}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await jitter(2500, 4000);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) {
    await page.keyboard.press("Escape");
    await jitter(500, 1000);
  }
  await dump(page, "70_editor_ready_for_delete");

  console.log("[2] click 'Еще' (More) in navbar");
  const moreBtn = page.getByText("Еще", { exact: false });
  if (await moreBtn.count() === 0) {
    console.log("  Еще not found");
    await dump(page, "70b_no_more");
    await context.close(); await browser.close(); process.exit(2);
  }
  await moreBtn.first().click({ timeout: 5000 });
  await jitter(800, 1500);
  await dump(page, "71_more_menu_open");

  // Probe menu items for "Удалить страницу" / "Delete page"
  console.log("[3] probe menu items");
  const menuItems = await page.evaluate(() => {
    const out = [];
    const all = document.querySelectorAll('a, button, div[onclick], li, span');
    for (const el of all) {
      const t = (el.innerText || el.textContent || '').trim();
      if (!t) continue;
      if (t.length > 80) continue;
      if (/удал|delete/i.test(t)) {
        out.push({
          text: t,
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 80),
          onclick: el.getAttribute('onclick')?.slice(0, 200) ?? '',
          parent: el.parentElement?.tagName.toLowerCase() ?? '',
        });
      }
    }
    return out.slice(0, 30);
  });
  console.log("  delete-related items:");
  menuItems.forEach(m => console.log(`    "${m.text}" <${m.tag}.${m.cls}> onclick="${m.onclick}"`));

  // Try direct click on "Удалить страницу"
  const preDel = network.length;
  console.log("[4] click 'Удалить страницу'");
  try {
    const delLink = page.getByText("Удалить страницу", { exact: false });
    if (await delLink.count()) {
      await delLink.first().click({ timeout: 5000 });
      await jitter(3000, 5000);
    } else {
      console.log("  not found, trying 'Удалить'");
      await page.getByText("Удалить", { exact: false }).first().click({ timeout: 5000 });
      await jitter(3000, 5000);
    }
  } catch (e) {
    console.log(`  click failed: ${e.message.substring(0, 100)}`);
  }
  await dump(page, "72_after_delete_click");

  console.log("[5] post-click network (non-GET or with delete/submit):");
  network.slice(preDel).forEach((n, i) => {
    if (n.phase === "req" && (n.method !== "GET" || n.url.match(/delete|submit|page\/del/i))) {
      console.log(`  [${preDel + i}] REQ ${n.method} ${n.url}`);
      if (n.postData) console.log(`        body: ${n.postData.substring(0, 300)}`);
    }
    if (n.phase === "res" && n.url.match(/delete|submit|page\/del/i)) {
      console.log(`  [${preDel + i}] RES ${n.status} ${n.url}`);
      if (n.body) console.log(`        body: ${n.body.substring(0, 200).replace(/\n/g, " ")}`);
    }
  });

  writeFileSync(join(OUT_DIR, "explore7b_network.json"), JSON.stringify(network, null, 2));
  await context.close(); await browser.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
