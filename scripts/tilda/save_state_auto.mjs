#!/usr/bin/env node
// Auto-save state when redirected to /projects/ after manual login.
import { chromium } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";
import { chmodSync } from "node:fs";
const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");

const browser = await chromium.launch({
  headless: false,
  args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  locale: "en-US", timezoneId: "Europe/Berlin",
});
await ctx.addInitScript(() => {
  Object.defineProperty(Object.getPrototypeOf(navigator), "webdriver", { get: () => undefined });
  if (!window.chrome) window.chrome = { runtime: {} };
});
const page = await ctx.newPage();
console.log("[1] tilda.ru/login");
await page.goto("https://tilda.ru/login/", { waitUntil: "domcontentloaded", timeout: 30_000 });
await new Promise(r => setTimeout(r, 1500));
try { await page.locator('input[name="email"]').fill("karinabim24@gmail.com"); } catch {}
try { await page.locator('input[name="password"]').fill("123456789010"); } catch {}
console.log("[2] WSLg window OPEN.");
console.log("    Solve captcha if any, click 'Log in', wait for /projects/.");
console.log("    Polling URL every 3s; saves state on /projects/ then exits.");
for (let i = 0; i < 120; i++) { // up to 6 min
  await new Promise(r => setTimeout(r, 3000));
  const url = page.url();
  if (url.includes("/projects/")) {
    console.log(`  [t=${(i+1)*3}s] reached ${url} — saving state`);
    await ctx.storageState({ path: STATE_PATH });
    chmodSync(STATE_PATH, 0o600);
    console.log("  state saved.");
    break;
  }
  if (i % 4 === 0) console.log(`  [t=${(i+1)*3}s] url: ${url.slice(-80)}`);
}
await browser.close();
console.log("[done]");
