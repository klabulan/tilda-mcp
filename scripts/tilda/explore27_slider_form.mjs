#!/usr/bin/env node
// Explore 27: capture slider (T0833) + form (T2441) content schemas in one session.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
mkdirSync(OUT_DIR, { recursive: true });
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
    .filter(c => (c.domain.startsWith(".") ? c.domain.slice(1) : c.domain) === "tilda.ru" || c.domain === ".tilda.ru")
    .filter(c => c.expires < 0 || c.expires > now)
    .map(c => `${c.name}=${c.value}`).join("; ");
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

async function capture(tplid, label) {
  const cookieHeader = await loadCookieHeader();
  const { pageId, recordId } = await setupViaXhr(cookieHeader, tplid);
  console.log(`\n=== ${label} (tplid=${tplid}) page=${pageId} record=${recordId} ===`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US", timezoneId: "Europe/Berlin",
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
    if (!pd.includes("comm=") && !pd.includes("recordid=")) return;
    if (!u.includes("/submit")) return;
    let body = "";
    try { body = (await res.body()).toString("utf8").slice(0, 1000); } catch {}
    submitCalls.push({ url: u, status: res.status(), postData: pd.slice(0, 8000), body });
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { await d.accept(); });

  await page.goto(`https://tilda.ru/page/?pageid=${pageId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('text="Настройки"', { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) { await page.keyboard.press("Escape"); await jitter(500, 1000); }

  // Click Контент on block
  await page.locator(`#record${recordId}`).hover({ timeout: 5000 }).catch(() => {});
  await jitter(800, 1500);
  try { await page.getByText("Контент", { exact: true }).first().click({ timeout: 4000 }); } catch {}
  await jitter(2500, 3500);
  await dump(page, `27_${label}_content_panel`);

  // Click Save
  for (const s of ['input.js-ps-popup-submit', 'input[value="Сохранить изменения"]', 'input.td-popup-btn', 'button:has-text("Сохранить")']) {
    if (await page.locator(s).count()) {
      try { await page.locator(s).first().click({ timeout: 3000 }); break; } catch {}
    }
  }
  await jitter(3000, 4500);

  console.log(`  ${submitCalls.length} submit-calls captured`);
  submitCalls.slice(-2).forEach((c) => {
    console.log(`    ${c.status} ${c.url}`);
    console.log(`    body: ${c.postData.substring(0, 1500)}`);
  });

  writeFileSync(join(OUT_DIR, `explore27_${label}.json`), JSON.stringify(submitCalls, null, 2));
  await deletePage(cookieHeader, pageId);
  await context.close();
}

await capture(833, "slider_T0833");
await capture(2441, "form_T2441");
console.log("[done]");
