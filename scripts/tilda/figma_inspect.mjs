#!/usr/bin/env node
// Open the failclub Figma URL in headed Chromium (WSLg) and dump the file canvas
// page-tree info. If Figma asks for login, log in with creds from $FIGMA_EMAIL
// + $FIGMA_PASSWORD (which we read from /home/levko/failclub_landing/credentials.local.md
// at run time, in env-only fashion so the password never lands in a file).

import { chromium } from "playwright";
import { homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const OUT_DIR = join(process.cwd(), "scripts/tilda/figma-out");
const FIGMA_URL = "https://www.figma.com/design/OYVteYmooNecQoLRTHPumz/Untitled?m=auto&t=sfqojoc8TYJLmAU9-6";
const FIGMA_PROFILE = join(homedir(), ".cache/figma-mcp-profile");
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(FIGMA_PROFILE, { recursive: true });

const CREDS_FILE = "/home/levko/failclub_landing/credentials.local.md";
function readFigmaCreds() {
  if (!existsSync(CREDS_FILE)) return null;
  const md = readFileSync(CREDS_FILE, "utf8");
  // Match "## Figma" then "Логин:" + "Пароль:"
  const blk = md.split(/^##\s+Figma/im)[1] || "";
  const email = blk.match(/Логин:\s*`([^`]+)`/i)?.[1] ?? null;
  const password = blk.match(/Пароль:\s*`([^`]+)`/i)?.[1] ?? null;
  return { email, password };
}

async function jitter(min, max) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }

async function main() {
  const creds = readFigmaCreds();
  const context = await chromium.launchPersistentContext(FIGMA_PROFILE, {
    headless: false,                // headed via WSLg so user can solve captcha if any
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US", timezoneId: "Europe/Berlin", slowMo: 250,
  });
  await context.addInitScript(() => {
    Object.defineProperty(Object.getPrototypeOf(navigator), "webdriver", { get: () => undefined });
    if (!window.chrome) window.chrome = { runtime: {} };
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { console.log(`  DIALOG: ${d.message().substring(0, 100)}`); await d.accept(); });
  page.on("console", (msg) => { if (msg.type() === "error") {} });

  console.log("[1] go to Figma file URL");
  await page.goto(FIGMA_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await jitter(3000, 5000);

  // If figma redirected to /login/, try auto-login
  if (page.url().includes("/login")) {
    console.log("[2] login page detected");
    if (!creds || !creds.email || !creds.password) {
      console.error("  no credentials parsed from credentials.local.md");
      await context.close();
      process.exit(2);
    }
    console.log(`  logging in as ${creds.email}`);
    try { await page.locator('input[name="email"]').fill(creds.email, { timeout: 5000 }); } catch {}
    try { await page.locator('input[type="email"]').fill(creds.email, { timeout: 5000 }); } catch {}
    await jitter(400, 800);
    try { await page.locator('input[name="password"]').fill(creds.password, { timeout: 5000 }); } catch {}
    try { await page.locator('input[type="password"]').fill(creds.password, { timeout: 5000 }); } catch {}
    await jitter(400, 800);
    try { await page.locator('button[type="submit"]').first().click({ timeout: 5000 }); } catch {}
    // Wait for redirect away from /login/
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (!page.url().includes("/login")) break;
    }
    console.log(`  url now: ${page.url()}`);
    // If still on login (e.g. captcha) — pause for user
    if (page.url().includes("/login")) {
      console.log("  ⚠️  still on login page — likely CAPTCHA. Solve it in the WSLg window. Waiting up to 5 min...");
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (!page.url().includes("/login")) break;
      }
      console.log(`  url now: ${page.url()}`);
    }
  }

  console.log("[3] wait for editor canvas / page-list to render");
  // Figma's editor uses canvas; the page list is in the left panel (data-testid usually).
  await jitter(8000, 12000);
  await page.screenshot({ path: join(OUT_DIR, "fig_01_loaded.png"), fullPage: false }).catch(() => {});

  console.log("[4] read page-list + frames from DOM");
  const probe = await page.evaluate(() => {
    const out = { title: document.title, url: location.href, pages: [], frames: [] };
    // Page tabs/panel
    document.querySelectorAll('[data-testid*="page" i], [data-testid*="canvas" i], .page-list-item, [role="treeitem"]').forEach(el => {
      const t = (el.innerText || el.textContent || "").trim().slice(0, 80);
      if (t && t.length < 80) out.pages.push({ text: t, testid: el.getAttribute("data-testid") || "", role: el.getAttribute("role") || "" });
    });
    // Frame list
    document.querySelectorAll('[data-testid*="frame" i]').forEach(el => {
      const t = (el.innerText || el.textContent || "").trim().slice(0, 80);
      if (t) out.frames.push(t);
    });
    out.bodyText = (document.body?.innerText || "").slice(0, 4000);
    return out;
  });
  console.log("=== probe ===");
  console.log(JSON.stringify({ ...probe, bodyText: probe.bodyText.slice(0, 1500) }, null, 2));

  writeFileSync(join(OUT_DIR, "fig_probe.json"), JSON.stringify(probe, null, 2));

  // Keep window open 30s so user can inspect / share screen
  console.log("\n[5] keeping window open 30s for visual inspection");
  await new Promise(r => setTimeout(r, 30_000));
  await page.screenshot({ path: join(OUT_DIR, "fig_99_after_wait.png"), fullPage: false }).catch(() => {});

  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
