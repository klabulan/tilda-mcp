#!/usr/bin/env node
// Explore 12: HEADED mode via WSLg. Open ZB editor, dump full UI from inside iframe,
// wait for user if CAPTCHA pops, then probe controls + capture save endpoint.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PAGE_ID = process.env.PAGE_ID ?? "142152756";
const RECORD_ID = process.env.RECORD_ID ?? "2278548451";

async function jitter(min, max) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }
async function dumpFrame(frameOrPage, label) {
  const safe = label.replace(/[^a-z0-9_-]/gi, "_");
  // screenshot is on page only
  if (frameOrPage.screenshot) {
    await frameOrPage.screenshot({ path: join(OUT_DIR, `${safe}.png`), fullPage: true }).catch(() => {});
  }
  const html = await frameOrPage.content().catch(() => "<error>");
  writeFileSync(join(OUT_DIR, `${safe}.html`), html);
  console.log(`  dumped ${label} (html=${html.length})`);
}

async function waitForCaptchaCleared(page, timeoutMs = 300_000) {
  const start = Date.now();
  let seen = false;
  while (Date.now() - start < timeoutMs) {
    const c = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="smartcaptcha"]').count();
    if (c === 0) {
      if (seen) console.log("  [captcha] cleared — resuming");
      return true;
    }
    if (!seen) {
      console.log("\n  ⚠️  CAPTCHA detected — solve it in the WSLg window. Resuming when iframe disappears.");
      seen = true;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.error("  [captcha] timeout waiting for user");
  return false;
}

async function main() {
  // Use persistent context so Tilda sees a consistent profile (less anti-bot).
  // ALSO load storageState — persistent profile alone doesn't carry over fresh cookies.
  console.log(`[setup] HEADED Chromium via WSLg (DISPLAY=${process.env.DISPLAY})`);
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "Europe/Berlin",
    slowMo: 200,
  });

  // Inject cookies from state.json into the persistent context.
  // (launchPersistentContext doesn't accept storageState parameter; we addCookies manually.)
  const fs = await import("node:fs");
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  await context.addCookies(state.cookies.map(c => ({
    name: c.name, value: c.value,
    domain: c.domain.startsWith(".") ? c.domain : c.domain,
    path: c.path, expires: c.expires, httpOnly: !!c.httpOnly, secure: !!c.secure,
    sameSite: c.sameSite === "Lax" ? "Lax" : c.sameSite === "None" ? "None" : c.sameSite === "Strict" ? "Strict" : "Lax",
  })));
  console.log(`  injected ${state.cookies.length} cookies`);

  // anti-bot init script
  await context.addInitScript(() => {
    Object.defineProperty(Object.getPrototypeOf(navigator), "webdriver", { get: () => undefined });
    if (!window.chrome) window.chrome = { runtime: {} };
  });

  const network = [];
  let zeroBodies = [];
  context.on("request", (req) => {
    const u = req.url();
    if (!u.match(/tilda\.(cc|ru)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico|js)\b/)) return;
    network.push({ phase: "req", method: req.method(), url: u, postData: req.postData(), hdr: req.headers() });
  });
  context.on("response", async (res) => {
    const req = res.request();
    const u = req.url();
    if (!u.match(/tilda\.(cc|ru)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico|js)\b/)) return;
    let body = null;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("json") || ct.includes("text") || ct.includes("javascript") || ct.includes("html")) {
        const buf = await res.body();
        const full = buf.toString("utf8");
        const pd = req.postData() || "";
        if (pd.includes("zerocode") || pd.includes("zero") || u.includes("/zero/")) {
          zeroBodies.push({ url: u, status: res.status(), postData: pd.slice(0, 300), body: full.slice(0, 8000) });
        }
        body = full.slice(0, 2000);
      }
    } catch {}
    network.push({ phase: "res", url: u, status: res.status(), body });
  });

  const pages = context.pages();
  const page = pages[0] ?? await context.newPage();
  page.on("dialog", async (d) => { console.log(`  DIALOG: ${d.message().substring(0, 100)}`); await d.accept(); });

  // === STEP 1: open ZB editor at correct URL ===
  const url = `https://tilda.ru/zero/?recordid=${RECORD_ID}&pageid=${PAGE_ID}`;
  console.log(`\n[1] navigate to ZB editor: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await jitter(3000, 5000);

  console.log("[1b] check for CAPTCHA");
  await waitForCaptchaCleared(page);

  // wait for editor to fully render (iframe lazy-loads)
  console.log("[2] waiting for ZB iframe to render (up to 25s)");
  let zbFrameUrl = null;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const fs = page.frames();
    const z = fs.find(f => f.url().includes("/zero/") && f.url() !== page.url());
    if (z) {
      zbFrameUrl = z.url();
      console.log(`  found ZB frame after ${i+1}s: ${zbFrameUrl}`);
      break;
    }
  }

  await dumpFrame(page, "120_zb_outer_after_load");
  console.log(`  page url: ${page.url()}`);
  console.log(`  page.title: ${await page.title().catch(() => "?")}`);
  console.log(`  total frames: ${page.frames().length}`);
  page.frames().forEach(f => console.log(`    frame: ${f.url().substring(0, 90)}`));

  // === STEP 3: probe inner ZB iframe ===
  const zbFrame = page.frames().find(f => f.url().includes("/zero/") && f.url() !== page.url())
                ?? page.frames().find(f => f.url().includes("zero"))
                ?? page.mainFrame();
  console.log(`\n[3] probe ZB iframe (url=${zbFrame.url().substring(0, 100)})`);
  try {
    await dumpFrame(zbFrame, "121_zb_inner_frame");
  } catch (e) { console.log(`  dump fail: ${e.message.substring(0, 100)}`); }

  // Probe all clickable items inside iframe
  const probe = await zbFrame.evaluate(() => {
    const out = { buttons: [], inputs: [], fns: [], allClass: {} };
    document.querySelectorAll('button, a, [class*="toolbar"], [class*="tool"], [class*="action"], [data-tool]').forEach(el => {
      const t = (el.innerText || el.textContent || '').trim().slice(0, 50);
      const cls = (el.className || '').toString().slice(0, 100);
      const title = el.getAttribute('title') || '';
      const dt = el.getAttribute('data-tool') || '';
      if (t || title || dt) out.buttons.push({ t, cls, title, dt });
    });
    document.querySelectorAll('input, textarea').forEach(el => {
      out.inputs.push({ name: el.name || '', type: el.type || '', id: el.id || '', placeholder: el.placeholder || '' });
    });
    for (const k of Object.keys(window)) {
      try {
        if (typeof window[k] === "function" && /tn[_-]?(add|create|insert|save|update)|atom[_-]?(add|save|create)|zb[_-]?(add|save)/i.test(k)) {
          out.fns.push(k);
        }
      } catch {}
    }
    return out;
  }).catch(e => ({ err: e.message.substring(0, 200) }));
  console.log(`  ZB iframe probe:`);
  if (probe.err) { console.log(`    ERR: ${probe.err}`); }
  else {
    console.log(`    buttons: ${probe.buttons.length}`);
    probe.buttons.slice(0, 30).forEach(b => console.log(`      "${b.t}" data-tool="${b.dt}" title="${b.title}" cls="${b.cls.slice(0, 60)}"`));
    console.log(`    inputs: ${probe.inputs.length}`);
    console.log(`    add/save fns: ${probe.fns.slice(0, 30).join(", ")}`);
  }

  console.log(`\n[4] zero/* network captures so far: ${zeroBodies.length}`);
  zeroBodies.slice(0, 5).forEach((z, i) => {
    console.log(`  [${i}] ${z.status} ${z.url}`);
    console.log(`      post: ${z.postData.substring(0, 150)}`);
    console.log(`      body[0..300]: ${z.body.substring(0, 300).replace(/\n/g, " ")}`);
  });
  if (zeroBodies.length > 0) {
    writeFileSync(join(OUT_DIR, "explore12_zerocode.txt"), zeroBodies.map(z => `=== ${z.url} (${z.status}) ===\nPOST: ${z.postData}\n\n${z.body}`).join("\n\n---\n\n"));
  }

  writeFileSync(join(OUT_DIR, "explore12_network.json"), JSON.stringify(network, null, 2));

  // === STEP 5: keep window open ~10s so user can inspect ===
  console.log("\n[5] keep window open 8s for visual inspection...");
  await new Promise(r => setTimeout(r, 8000));

  await context.close();
  console.log("[done]");
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
