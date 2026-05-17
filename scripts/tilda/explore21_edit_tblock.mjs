#!/usr/bin/env node
// Explore 21: capture generic T-block edit endpoint.
// Setup: add T0868 (HTML popup) → open its block settings via UI → change html code → save → capture XHR.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PROJECT_ID = "25668306";

async function jitter(min, max) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }
async function dump(page, label) {
  const safe = label.replace(/[^a-z0-9_-]/gi, "_");
  await page.screenshot({ path: join(OUT_DIR, `${safe}.png`), fullPage: true }).catch(() => {});
  writeFileSync(join(OUT_DIR, `${safe}.html`), await page.content().catch(() => "<error>"));
}

async function loadCookieHeader() {
  const fs = await import("node:fs");
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const now = Date.now() / 1000;
  return state.cookies
    .filter((c) => (c.domain.startsWith(".") ? c.domain.slice(1) : c.domain) === "tilda.ru" || c.domain === ".tilda.ru")
    .filter((c) => c.expires < 0 || c.expires > now)
    .map((c) => `${c.name}=${c.value}`).join("; ");
}

async function setupViaXhr(cookieHeader, tplid) {
  const baseHeaders = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Cookie": cookieHeader, "Origin": "https://tilda.ru", "Referer": "https://tilda.ru/projects/",
    "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  };
  const cp = await fetch("https://tilda.ru/projects/submit/", { method: "POST", headers: baseHeaders, body: new URLSearchParams({ comm: "addnewpagedublicateexample", projectid: PROJECT_ID, examplepageid: "1231", folderid: "", csrf: "" }) });
  const pageId = (await cp.text()).trim();
  const ab = await fetch("https://tilda.ru/page/submit/", { method: "POST", headers: baseHeaders, body: new URLSearchParams({ comm: "addnewrecord", pageid: pageId, tplid: String(tplid), with_code: "yes" }) });
  const raw = (await ab.text()).replace(/^<!--tlp-->\s*/, "");
  const recordId = JSON.parse(raw).html.match(/id="record(\d+)"/)?.[1];
  return { pageId, recordId };
}

async function deletePage(cookieHeader, pageId) {
  await fetch("https://tilda.ru/projects/submit/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookieHeader, "Origin": "https://tilda.ru", "Referer": "https://tilda.ru/projects/", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/plain, */*" },
    body: new URLSearchParams({ comm: "delpage", pageid: pageId, csrf: "" }),
  });
}

async function main() {
  const cookieHeader = await loadCookieHeader();
  // Add T0868 — Popup: HTML-код. Has a single 'code' (HTML) field.
  const { pageId, recordId } = await setupViaXhr(cookieHeader, 868);
  console.log(`page=${pageId} html-popup-record=${recordId}`);

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

  const submitCalls = [];
  context.on("response", async (res) => {
    const u = res.request().url();
    if (!u.match(/tilda\.(cc|ru)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico|js)\b/)) return;
    const pd = res.request().postData() || "";
    if (!pd.includes("comm=") || !u.includes("/submit")) return;
    let body = "";
    try {
      const buf = await res.body();
      body = buf.toString("utf8").slice(0, 1500);
    } catch {}
    submitCalls.push({ url: u, status: res.status(), postData: pd.slice(0, 800), body });
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { await d.accept(); });

  console.log("[1] open page editor");
  await page.goto(`https://tilda.ru/page/?pageid=${pageId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('text="Настройки"', { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) { await page.keyboard.press("Escape"); await jitter(500, 1000); }

  console.log("[2] click 'Контент' on the T0868 block (hover first)");
  // T-block has hover-actions: Content, Settings, Delete, Up/Down
  const blockSel = `#record${recordId}`;
  await page.locator(blockSel).hover({ timeout: 5000 }).catch(() => {});
  await jitter(800, 1500);
  await dump(page, "210_after_hover");

  // Click 'Контент' (Content) button — usually labeled
  const preEdit = submitCalls.length;
  for (const text of ["Контент", "Content"]) {
    try {
      const btn = page.getByText(text, { exact: true });
      if (await btn.count() > 0) {
        console.log(`  click '${text}'`);
        await btn.first().click({ timeout: 4000 });
        await jitter(2000, 3000);
        break;
      }
    } catch {}
  }
  await dump(page, "211_content_panel");

  console.log("[3] find HTML code input + change");
  // Tilda's HTML edit area is usually <textarea name="code"> or CodeMirror.
  const newHtml = `<div style="padding:40px;font-family:Arial;text-align:center"><h2>MCP wrote this HTML</h2><p>Edited via captured edit endpoint.</p></div>`;
  let filled = false;
  for (const sel of ['textarea[name="code"]', 'textarea#code', 'textarea.CodeMirror', '.popup-window textarea', '.td-popup-window textarea']) {
    if (await page.locator(sel).count()) {
      try { await page.locator(sel).first().fill(newHtml, { timeout: 3000 }); filled = true; console.log(`  filled ${sel}`); break; } catch {}
    }
  }
  console.log(`  filled: ${filled}`);
  await jitter(800, 1500);
  await dump(page, "212_filled");

  console.log("[4] click Save");
  for (const sel of ['input.js-ps-popup-submit', 'input[value="Сохранить изменения"]', 'input.td-popup-btn', '.td-popup-window button[type="submit"]', 'button:has-text("Сохранить")']) {
    if (await page.locator(sel).count()) {
      try { await page.locator(sel).first().click({ timeout: 3000 }); console.log(`  clicked ${sel}`); break; } catch {}
    }
  }
  await jitter(3000, 5000);

  console.log(`\n[5] submit calls after edit:`);
  submitCalls.slice(preEdit).forEach((c, i) => {
    console.log(`  [${preEdit + i}] ${c.status} ${c.url}`);
    console.log(`    post: ${c.postData.substring(0, 400)}`);
    if (c.body) console.log(`    body: ${c.body.substring(0, 200).replace(/\n/g, " ")}`);
  });

  writeFileSync(join(OUT_DIR, "explore21_submit.json"), JSON.stringify(submitCalls, null, 2));

  console.log("\n[cleanup] delete page");
  await deletePage(cookieHeader, pageId);
  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
