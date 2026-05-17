#!/usr/bin/env node
// Explore 20: For a popup record (T1093), find how Tilda inserts a Zero Block inside.
// Approach: open the page editor → click on the popup card → look for "Edit popup" / "Open ZB"
// flow → trigger the same XHR programmatically via window.tp__* functions.

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

async function setupViaXhr(cookieHeader) {
  const baseHeaders = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Cookie": cookieHeader, "Origin": "https://tilda.ru", "Referer": "https://tilda.ru/projects/",
    "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  };
  const cp = await fetch("https://tilda.ru/projects/submit/", { method: "POST", headers: baseHeaders, body: new URLSearchParams({ comm: "addnewpagedublicateexample", projectid: PROJECT_ID, examplepageid: "1231", folderid: "", csrf: "" }) });
  const pageId = (await cp.text()).trim();
  const ab = await fetch("https://tilda.ru/page/submit/", { method: "POST", headers: baseHeaders, body: new URLSearchParams({ comm: "addnewrecord", pageid: pageId, tplid: "1093", with_code: "yes" }) });
  const raw = (await ab.text()).replace(/^<!--tlp-->\s*/, "");
  const recordId = JSON.parse(raw).html.match(/id="record(\d+)"/)?.[1];
  return { pageId, popupRecordId: recordId };
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
  const { pageId, popupRecordId } = await setupViaXhr(cookieHeader);
  console.log(`page=${pageId} popup=${popupRecordId}`);

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

  const zeroCalls = [];
  const submitCalls = [];
  context.on("response", async (res) => {
    const u = res.request().url();
    if (!u.match(/tilda\.(cc|ru)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico|js)\b/)) return;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (!ct.includes("json") && !ct.includes("text") && !ct.includes("javascript")) return;
      const body = (await res.body()).toString("utf8");
      const pd = res.request().postData() || "";
      if (u.includes("/zero/")) zeroCalls.push({ url: u, status: res.status(), postData: pd, body: body.slice(0, 5000) });
      if (pd.includes("comm=") && (u.includes("/submit") || u.includes("/page/"))) {
        submitCalls.push({ url: u, status: res.status(), postData: pd.slice(0, 400), body: body.slice(0, 500) });
      }
    } catch {}
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { await d.accept(); });

  console.log(`[1] open main editor for page ${pageId}`);
  await page.goto(`https://tilda.ru/page/?pageid=${pageId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('text="Настройки"', { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) { await page.keyboard.press("Escape"); await jitter(500, 1000); }

  await dump(page, "200_with_popup");

  console.log("[2] hover the popup card to surface edit affordances");
  // popup record is in the DOM as #recordPOPUP_REC_ID
  const popupSel = `#record${popupRecordId}`;
  await page.locator(popupSel).hover({ timeout: 5000 }).catch(() => {});
  await jitter(800, 1500);
  await dump(page, "201_after_hover");

  console.log("[3] enumerate any contextual 'Edit' / 'Zero Block' / 'Открыть' actions");
  const ctxItems = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { err: "popup root not found" };
    const out = [];
    const all = document.querySelectorAll('[onclick], .t-btn, .td-button, button, a');
    for (const el of all) {
      const txt = (el.innerText || el.textContent || "").trim();
      if (!txt) continue;
      if (/zero|редакт|open|edit|открыт/i.test(txt) && txt.length < 60) {
        out.push({ text: txt.slice(0, 60), cls: (el.className || "").toString().slice(0, 60), oc: el.getAttribute("onclick")?.slice(0, 150) ?? "" });
      }
    }
    return { items: out.slice(0, 20) };
  }, popupSel);
  console.log("  candidate edit triggers:", JSON.stringify(ctxItems, null, 2));

  console.log("\n[4] try clicking the popup card body");
  const preClick = zeroCalls.length;
  await page.locator(popupSel).click({ position: { x: 100, y: 100 }, timeout: 5000 }).catch(() => {});
  await jitter(2000, 3000);
  await dump(page, "202_after_click");

  console.log("[5] try double-click the popup card");
  await page.locator(popupSel).dblclick({ timeout: 5000 }).catch(() => {});
  await jitter(2000, 3000);
  await dump(page, "203_after_dblclick");

  console.log("[6] try invoking tp__openZero(popupRecordId) directly");
  const r = await page.evaluate((rid) => {
    if (typeof window.tp__openZero !== "function") return { err: "no tp__openZero" };
    try { return { ok: true, ret: String(window.tp__openZero(rid)).slice(0, 100) }; }
    catch (e) { return { err: String(e).slice(0, 200) }; }
  }, popupRecordId);
  console.log("  result:", r);
  await jitter(4000, 6000);
  await dump(page, "204_after_tp_openZero");

  console.log(`\n[7] zero/* call count: ${zeroCalls.length}`);
  zeroCalls.slice(preClick).forEach((z, i) => {
    console.log(`  [${preClick + i}] ${z.status} ${z.url}`);
    console.log(`    post: ${z.postData.substring(0, 300)}`);
    console.log(`    body[0..300]: ${z.body.substring(0, 300).replace(/\n/g, " ")}`);
  });

  writeFileSync(join(OUT_DIR, "explore20_submit.json"), JSON.stringify(submitCalls, null, 2));
  writeFileSync(join(OUT_DIR, "explore20_zero.json"), JSON.stringify(zeroCalls, null, 2));

  console.log("\n[cleanup] delete page");
  await deletePage(cookieHeader, pageId);
  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
