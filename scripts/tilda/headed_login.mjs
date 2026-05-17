#!/usr/bin/env node
// Manual headed Tilda re-login through WSLg. Pre-fills creds; user solves captcha
// in the visible browser window. Saves fresh storageState on success.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const EMAIL = process.env.TILDA_EMAIL ?? "karinabim24@gmail.com";
const PASSWORD = process.env.TILDA_PASSWORD ?? "123456789010";

mkdirSync(dirname(STATE_PATH), { recursive: true, mode: 0o700 });

console.log(`[headed login] DISPLAY=${process.env.DISPLAY}`);
console.log(`  using email: ${EMAIL}`);

const browser = await chromium.launch({
  headless: false,
  args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  locale: "en-US",
  timezoneId: "Europe/Berlin",
});
await context.addInitScript(() => {
  Object.defineProperty(Object.getPrototypeOf(navigator), "webdriver", { get: () => undefined });
  if (!window.chrome) window.chrome = { runtime: {} };
});

const page = await context.newPage();
console.log("[1] open tilda.ru/login/");
await page.goto("https://tilda.ru/login/", { waitUntil: "domcontentloaded", timeout: 30_000 });
await new Promise(r => setTimeout(r, 1500));

console.log("[2] prefill email + password");
try { await page.locator('input[name="email"]').fill(EMAIL, { timeout: 5000 }); } catch {}
try { await page.locator('input[name="password"]').fill(PASSWORD, { timeout: 5000 }); } catch {}

console.log("\n  ⚠️  WSLg window is now open.");
console.log("  If a Yandex SmartCaptcha appears — solve it in the window.");
console.log("  Then click 'Log in' button (or it may submit automatically).");
console.log("  Wait until you see your project list at tilda.ru/projects/.");
console.log("  Then press Enter HERE to save the session state.\n");

await new Promise(resolve => {
  const rl = createInterface({ input: process.stdin });
  rl.question("[press Enter when logged in] ", () => { rl.close(); resolve(); });
});

const url = page.url();
console.log(`\n  current url: ${url}`);
if (url.includes("/login")) {
  console.error("  !! still on /login — state will be saved anyway, but it may not work.");
}

await context.storageState({ path: STATE_PATH });
chmodSync(STATE_PATH, 0o600);
console.log(`  state saved → ${STATE_PATH}`);

await browser.close();
console.log("[done]");
