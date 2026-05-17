#!/usr/bin/env node
// One-off exploration script: login to Tilda autonomously, then crawl key UI views
// (projects list, project view, page editor, publish flow) and dump screenshot +
// DOM snapshot for each, so the orchestrator can derive selectors offline.
//
// Usage:
//   TILDA_EMAIL=... TILDA_PASSWORD=... node scripts/tilda/explore.mjs
//
// Output goes to ./scripts/tilda/explore-out/<step>.{png,html,console.log,network.json}
// State persisted to ~/.config/tilda-mcp/state.json on successful login.

import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const EMAIL = process.env.TILDA_EMAIL;
const PASSWORD = process.env.TILDA_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Need TILDA_EMAIL + TILDA_PASSWORD env vars");
  process.exit(1);
}

const STATE_PATH = process.env.TILDA_MCP_STATE_PATH ?? join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = process.env.TILDA_MCP_PROFILE_DIR ?? join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");

mkdirSync(dirname(STATE_PATH), { recursive: true, mode: 0o700 });
mkdirSync(PROFILE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const REALISTIC_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

const HEADED = process.env.HEADED !== "0"; // default headed via WSLg
const SLOW_MS = parseInt(process.env.SLOW_MS ?? "300", 10);

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function jitter(min = 400, max = 1200) {
  await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

async function dumpStep(page, label) {
  const safe = label.replace(/[^a-z0-9_-]/gi, "_");
  const png = join(OUT_DIR, `${safe}.png`);
  const html = join(OUT_DIR, `${safe}.html`);
  await page.screenshot({ path: png, fullPage: true }).catch((e) => console.error(`  screenshot fail: ${e.message}`));
  const content = await page.content().catch(() => "<error>");
  writeFileSync(html, content);
  console.log(`  dumped ${label}: ${png}`);
}

async function main() {
  console.log(`[explore] headed=${HEADED} slowMo=${SLOW_MS}ms profile=${PROFILE_DIR}`);

  // Use persistent context so Tilda sees a "returning user" cache/cookies state.
  // Disables --disable-blink-features=AutomationControlled in launchPersistentContext args.
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !HEADED,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    viewport: { width: 1440, height: 900 },
    userAgent: REALISTIC_UA,
    locale: "en-US",
    timezoneId: "Europe/Berlin",
    slowMo: SLOW_MS,
  });

  await context.addInitScript(() => {
    Object.defineProperty(Object.getPrototypeOf(navigator), "webdriver", { get: () => undefined });
    if (!window.chrome) window.chrome = { runtime: {} };
  });

  // Capture network for forensics
  const network = [];
  context.on("request", (req) => {
    if (req.url().includes("tilda")) network.push({ ts: Date.now(), m: req.method(), u: req.url() });
  });

  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error(`  [page console.error] ${msg.text().substring(0, 200)}`);
  });

  // --- step 1: open login ---
  console.log("[1] goto /login/");
  await page.goto("https://tilda.cc/login/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await jitter(800, 1500);
  await dumpStep(page, "01_login_page");

  // --- step 2: check for captcha presence before submitting ---
  const captchaPre = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]').count();
  console.log(`  pre-submit captcha iframes: ${captchaPre}`);

  // --- step 3: fill + submit ---
  console.log("[2] fill email/password");
  // Try common selectors
  const emailSel = ['input[name="email"]', 'input[type="email"]', 'input#email'];
  const passSel = ['input[name="password"]', 'input[type="password"]', 'input#password'];

  let emailFilled = false;
  for (const s of emailSel) {
    if (await page.locator(s).count()) {
      await page.locator(s).first().fill(EMAIL, { timeout: 5_000 });
      emailFilled = true;
      console.log(`  email -> ${s}`);
      break;
    }
  }
  if (!emailFilled) {
    console.error("  email field not found");
    await dumpStep(page, "02_no_email_field");
    await context.close();
    process.exit(2);
  }
  await jitter(300, 700);
  for (const s of passSel) {
    if (await page.locator(s).count()) {
      await page.locator(s).first().fill(PASSWORD, { timeout: 5_000 });
      console.log(`  password -> ${s}`);
      break;
    }
  }
  await jitter(500, 1000);

  // Find submit button
  const submitCandidates = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Log in")',
    'button:has-text("Sign in")',
    'button:has-text("Войти")',
  ];
  for (const s of submitCandidates) {
    if (await page.locator(s).count()) {
      console.log(`  submit -> ${s}`);
      await page.locator(s).first().click({ timeout: 5_000 });
      break;
    }
  }

  // --- step 4: wait for redirect to /projects/ or captcha ---
  console.log("[3] waiting for redirect to /projects/ or captcha");
  let success = false;
  let captchaSeen = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const url = page.url();
    const captcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]').count();
    if (captcha > 0 && !captchaSeen) {
      console.log(`  CAPTCHA appeared at t=${i + 1}s`);
      captchaSeen = true;
      await dumpStep(page, "03_captcha_present");
    }
    if (url.includes("/projects/") || url.includes("/account/")) {
      success = true;
      console.log(`  redirect to ${url} at t=${i + 1}s`);
      break;
    }
  }

  await dumpStep(page, "04_after_login_attempt");

  if (!success) {
    console.error("  login did not redirect to /projects/ within 30s");
    console.error("  current url:", page.url());
    writeFileSync(join(OUT_DIR, "network.json"), JSON.stringify(network, null, 2));
    await context.close();
    process.exit(3);
  }

  // --- step 5: save state ---
  console.log("[4] save storageState");
  await context.storageState({ path: STATE_PATH });
  try {
    const { chmodSync } = await import("node:fs");
    chmodSync(STATE_PATH, 0o600);
  } catch {}
  console.log(`  saved -> ${STATE_PATH}`);

  // --- step 6: explore project list ---
  console.log("[5] dump projects list view");
  if (!page.url().includes("/projects/")) await page.goto("https://tilda.cc/projects/");
  await jitter(1000, 2000);
  await dumpStep(page, "05_projects_list");

  // --- step 7: enter FailClub project ---
  const PROJECT_ID = "25668306";
  console.log(`[6] open project ${PROJECT_ID}`);
  await page.goto(`https://tilda.cc/projects/?projectid=${PROJECT_ID}`);
  await jitter(2000, 3000);
  await dumpStep(page, "06_project_view");

  console.log("[7] writing network log");
  writeFileSync(join(OUT_DIR, "network.json"), JSON.stringify(network, null, 2));

  console.log("[done] keep state? closing context.");
  await context.close();
}

main().catch((e) => {
  console.error("explore failed:", e.message);
  process.exit(1);
});
