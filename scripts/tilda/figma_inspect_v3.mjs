#!/usr/bin/env node
// Figma v3: long wait + aggressive zoom out + open layers tree.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "scripts/tilda/figma-out");
const FIGMA_URL = "https://www.figma.com/design/OYVteYmooNecQoLRTHPumz/Untitled?m=auto&t=sfqojoc8TYJLmAU9-6";
const FIGMA_PROFILE = join(homedir(), ".cache/figma-mcp-profile");
mkdirSync(OUT_DIR, { recursive: true });

async function jitter(min, max) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }

async function main() {
  const context = await chromium.launchPersistentContext(FIGMA_PROFILE, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US", timezoneId: "Europe/Berlin", slowMo: 250,
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { await d.accept(); });

  console.log("[1] goto");
  await page.goto(FIGMA_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

  console.log("[2] long wait (up to 180s) for file to fully load");
  for (let i = 1; i <= 36; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pct = await page.evaluate(() => {
      const el = [...document.querySelectorAll("*")].find(e => /^\d+%$/.test((e.innerText || "").trim()));
      return el ? el.innerText.trim() : null;
    });
    console.log(`  t=${i*5}s — loaded: ${pct ?? "?"}`);
    if (!pct) { console.log("  loading indicator gone"); break; }
    if (pct === "100%") break;
  }
  await page.screenshot({ path: join(OUT_DIR, "v3_01_loaded.png"), fullPage: false });

  console.log("[3] keyboard zoom out hard (10x Ctrl+-)");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Control+-").catch(() => {});
    await new Promise(r => setTimeout(r, 200));
  }
  await jitter(1500, 2500);
  await page.screenshot({ path: join(OUT_DIR, "v3_02_zoom_out.png"), fullPage: false });

  console.log("[4] try Shift+1 (fit-to-screen) for whole file");
  await page.keyboard.press("Shift+1").catch(() => {});
  await jitter(1500, 2500);
  await page.screenshot({ path: join(OUT_DIR, "v3_03_fit.png"), fullPage: false });

  // Try cmd-palette: "/" or Ctrl+/ — Figma quick-find with frame names
  console.log("[5] try '/' or Ctrl+/ — quick-find");
  await page.keyboard.press("/").catch(() => {});
  await jitter(1500, 2500);
  await page.screenshot({ path: join(OUT_DIR, "v3_04_slash.png"), fullPage: false });
  await page.keyboard.press("Escape").catch(() => {});

  console.log("[6] enumerate all visible text (deeper scan)");
  const texts = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue?.trim();
      if (!t || t.length < 2 || t.length > 100) continue;
      const r = n.parentElement?.getBoundingClientRect();
      if (!r) continue;
      out.push({ t, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out.slice(0, 200);
  });
  console.log(`  ${texts.length} text nodes`);
  // Print left-panel candidates
  texts.filter(p => p.x < 320 && p.y > 60).slice(0, 50).forEach(p => console.log(`  @(${p.x},${p.y}): "${p.t}"`));
  writeFileSync(join(OUT_DIR, "v3_texts.json"), JSON.stringify(texts, null, 2));

  console.log("\n[7] full-page screenshot (final)");
  await page.screenshot({ path: join(OUT_DIR, "v3_05_final.png"), fullPage: false });

  // Keep open 20s
  await new Promise(r => setTimeout(r, 20_000));
  await context.close();
  console.log("[done]");
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
