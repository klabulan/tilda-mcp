#!/usr/bin/env node
// Explore 16: open Add Block panel in main editor, enumerate library: all T-codes + names.
// Specifically interested in forms / popups / buttons / multi-step funnel blocks.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PAGE_ID = process.env.PAGE_ID ?? "142152986";

async function jitter(min, max) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US", timezoneId: "Europe/Berlin", slowMo: 200,
  });
  const fs = await import("node:fs");
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  await context.addCookies(state.cookies.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires,
    httpOnly: !!c.httpOnly, secure: !!c.secure,
    sameSite: c.sameSite === "Lax" ? "Lax" : c.sameSite === "None" ? "None" : c.sameSite === "Strict" ? "Strict" : "Lax",
  })));

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { await d.accept(); });

  console.log("[1] open main editor");
  await page.goto(`https://tilda.ru/page/?pageid=${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('text="Настройки"', { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) {
    await page.keyboard.press("Escape");
    await jitter(500, 1000);
  }

  console.log("[2] click 'ВСЕ БЛОКИ' (or any add-block trigger)");
  // From earlier exploration we know the bottom panel has 'ВСЕ БЛОКИ' / Обложка / Заголовок / ...
  // 'ВСЕ БЛОКИ' opens the full library.
  const allBtn = page.getByText("ВСЕ БЛОКИ", { exact: false });
  if (await allBtn.count() === 0) {
    console.log("  'ВСЕ БЛОКИ' not visible — try Обложка");
  }
  try {
    await allBtn.first().click({ timeout: 5000 });
  } catch (e) {
    console.log(`  click failed: ${e.message.substring(0, 100)}`);
    try { await page.getByText("Обложка", { exact: true }).first().click({ timeout: 5000 }); } catch {}
  }
  await jitter(3000, 5000);

  console.log("[3] enumerate [data-tplid] elements (all T-blocks in library)");
  const tpls = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("[data-tplid]").forEach(el => {
      const id = el.getAttribute("data-tplid");
      // Try to get the label text from a sibling element
      const card = el.closest("[class*='library' i], [class*='tpl' i]") ?? el;
      const title = card.querySelector("[class*='title' i], [class*='cod' i]")?.textContent?.trim() ?? '';
      const cat = card.querySelector("[class*='cat' i]")?.textContent?.trim() ?? '';
      // tn-data-categories
      const cats = el.closest("[data-categories]")?.getAttribute("data-categories") ?? '';
      // class-based hint
      const cls = (el.className || '').toString().slice(0, 100);
      out.push({ tplid: id, title: title.slice(0, 80), cat: cat || cats, cls });
    });
    return out;
  });
  console.log(`  total tplids: ${tpls.length}`);
  // Group by category
  const buckets = {};
  tpls.forEach(t => {
    const key = t.title.toLowerCase();
    let bucket = "other";
    if (/форм|form|подписк|subscri|callback|обратн/i.test(key)) bucket = "form";
    if (/попап|popup|модал|modal|окно/i.test(key)) bucket = "popup";
    if (/кнопк|button/i.test(key)) bucket = "button";
    if (/zero|стандарт/i.test(key)) bucket = "zero";
    if (/обложк|заголов|hero|cover/i.test(key)) bucket = "hero";
    (buckets[bucket] ??= []).push(t);
  });
  console.log("\n=== Categorised ===");
  for (const k of Object.keys(buckets).sort()) {
    console.log(`  [${k}] ${buckets[k].length} items`);
    buckets[k].slice(0, 30).forEach(t => console.log(`    T${t.tplid.padStart(3,'0')}  ${t.title}`));
  }
  writeFileSync(join(OUT_DIR, "explore16_tblocks.json"), JSON.stringify(tpls, null, 2));
  writeFileSync(join(OUT_DIR, "explore16_buckets.json"), JSON.stringify(buckets, null, 2));
  console.log(`\n[4] keep window open 5s`);
  await new Promise(r => setTimeout(r, 5000));
  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
