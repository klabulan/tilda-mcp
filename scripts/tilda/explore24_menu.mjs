#!/usr/bin/env node
// Explore 24: capture menu (ME-block) content schema.
// Setup: add T1367 (ME201N: Меню с логотипом слева) to a scratch page, open block content
// settings in UI, change a menu item label + URL, save, capture XHR fields.

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

async function main() {
  // T1367 = ME201N — menu with logo on the left (one of simplest menus)
  const TPLID = 1367;
  const cookieHeader = await loadCookieHeader();
  const { pageId, recordId } = await setupViaXhr(cookieHeader, TPLID);
  console.log(`page=${pageId} menu-record=${recordId} (tplid=${TPLID})`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US", timezoneId: "Europe/Berlin", slowMo: 250,
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
    try { body = (await res.body()).toString("utf8").slice(0, 2000); } catch {}
    submitCalls.push({ url: u, status: res.status(), postData: pd.slice(0, 4000), body });
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { await d.accept(); });

  console.log("[1] open page editor");
  await new Promise(r => setTimeout(r, 3000));
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`https://tilda.ru/page/?pageid=${pageId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      break;
    } catch (e) {
      console.log(`  goto attempt ${i+1} fail: ${e.message.substring(0, 100)}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  await page.waitForSelector('text="Настройки"', { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) { await page.keyboard.press("Escape"); await jitter(500, 1000); }

  console.log("[2] click 'Контент' on the menu block");
  await page.locator(`#record${recordId}`).hover({ timeout: 5000 }).catch(() => {});
  await jitter(800, 1500);
  await dump(page, "240_menu_hover");

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
  await dump(page, "241_menu_content");

  console.log("[3] inspect popup inputs (menu items typically a textarea or rows of label+url)");
  const inputs = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input[type="text"], input:not([type]), textarea').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      out.push({
        tag: el.tagName.toLowerCase(),
        name: el.name || "",
        id: el.id || "",
        placeholder: el.placeholder || "",
        value: (el.value || "").slice(0, 60),
        cls: (el.className || "").toString().slice(0, 80),
      });
    });
    return out.slice(0, 40);
  });
  console.log(`  visible inputs: ${inputs.length}`);
  inputs.forEach(i => console.log(`    name="${i.name}" id="${i.id}" placeholder="${i.placeholder}" value="${i.value.slice(0, 40)}"`));

  console.log("[4] click Save (any apply button) and capture");
  const preSave = submitCalls.length;
  for (const s of ['input.js-ps-popup-submit', 'input[value="Сохранить изменения"]', 'input.td-popup-btn', 'button:has-text("Сохранить")']) {
    if (await page.locator(s).count()) {
      try { await page.locator(s).first().click({ timeout: 3000 }); console.log(`  clicked ${s}`); break; } catch {}
    }
  }
  await jitter(3000, 5000);

  console.log("[5] post-save submit calls:");
  submitCalls.slice(preSave).forEach((c, i) => {
    console.log(`  [${preSave + i}] ${c.status} ${c.url}`);
    console.log(`    post: ${c.postData.substring(0, 800)}`);
    if (c.body) console.log(`    body: ${c.body.substring(0, 200).replace(/\n/g, " ")}`);
  });

  writeFileSync(join(OUT_DIR, "explore24_submit.json"), JSON.stringify(submitCalls, null, 2));

  console.log("\n[cleanup] delete page");
  await deletePage(cookieHeader, pageId);
  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
