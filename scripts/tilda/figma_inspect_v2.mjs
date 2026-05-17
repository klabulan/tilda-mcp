#!/usr/bin/env node
// Figma inspect v2: wait fully for file load, dump multiple screenshots + Layers panel.

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
    locale: "en-US", timezoneId: "Europe/Berlin", slowMo: 200,
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { await d.accept(); });

  console.log("[1] go to file");
  await page.goto(FIGMA_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

  console.log("[2] wait 30s for file to load to 100% (Figma is heavy)");
  for (let i = 1; i <= 6; i++) {
    await new Promise(r => setTimeout(r, 5000));
    // Probe for the loading-percentage element
    const pct = await page.evaluate(() => {
      const el = [...document.querySelectorAll("*")].find(e => /^\d+%$/.test((e.innerText || "").trim()));
      return el ? el.innerText.trim() : null;
    });
    console.log(`  t=${i*5}s — loaded: ${pct ?? "?"}`);
  }
  await page.screenshot({ path: join(OUT_DIR, "v2_01_after_load.png"), fullPage: false });

  console.log("[3] click 'Layers' tab in left sidebar (or whatever opens the page tree)");
  // Figma left sidebar: title bar + Pages list + Layers tree. Selectors here are unstable.
  // Try a few patterns.
  for (const text of ["Layers", "Слои", "Pages"]) {
    try {
      const el = page.getByText(text, { exact: true });
      if (await el.count()) {
        await el.first().click({ timeout: 3000 });
        console.log(`  clicked '${text}'`);
        break;
      }
    } catch {}
  }
  await jitter(2000, 3000);
  await page.screenshot({ path: join(OUT_DIR, "v2_02_after_layers.png"), fullPage: false });

  console.log("[4] dump all visible text containing what looks like frame/page names");
  const probe = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll("div, span, button, a").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const t = (el.innerText || "").trim();
      if (!t || t.length > 120) return;
      // heuristic: filter out menu/toolbar — keep things in left panel (x < 320)
      if (r.left < 320 && r.top > 80 && r.top < window.innerHeight - 40) {
        items.push({ t, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) });
      }
    });
    return items.slice(0, 80);
  });
  console.log(`  ${probe.length} left-panel text items:`);
  probe.forEach(p => console.log(`    @(${p.x},${p.y}) w=${p.w}: "${p.t.replace(/\s+/g, ' ').slice(0, 60)}"`));
  writeFileSync(join(OUT_DIR, "v2_left_panel.json"), JSON.stringify(probe, null, 2));

  console.log("\n[5] zoom out (Ctrl+Shift+1 → Fit) to see all frames");
  await page.keyboard.press("Control+Shift+1").catch(() => {});
  await jitter(2500, 3500);
  await page.screenshot({ path: join(OUT_DIR, "v2_03_fit_to_screen.png"), fullPage: false });

  console.log("[6] try Ctrl+P (jump to anything) — Figma quick-find may reveal pages");
  await page.keyboard.press("Control+P").catch(() => {});
  await jitter(1500, 2500);
  await page.screenshot({ path: join(OUT_DIR, "v2_04_quickfind.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await jitter(500, 1000);

  console.log("[7] full-page screenshot");
  await page.screenshot({ path: join(OUT_DIR, "v2_05_final.png"), fullPage: true }).catch(() => {});
  await jitter(2000, 3000);
  await context.close();
  console.log("[done]");
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
