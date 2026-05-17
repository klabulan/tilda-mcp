#!/usr/bin/env node
// Explore 8: open the Zero Block sub-editor and capture its initial DOM + XHR baseline.
// Setup: create fresh page + add Zero Block via existing XHR endpoints, then navigate to its editor.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PROJECT_ID = "25668306";

async function jitter(min, max) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }
async function dump(page, label) {
  const safe = label.replace(/[^a-z0-9_-]/gi, "_");
  await page.screenshot({ path: join(OUT_DIR, `${safe}.png`), fullPage: true }).catch(() => {});
  writeFileSync(join(OUT_DIR, `${safe}.html`), await page.content().catch(() => "<error>"));
}

// Setup a fresh page + Zero Block via direct XHR (we know these work)
async function setupViaXhr(cookieHeader) {
  const baseHeaders = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Cookie": cookieHeader,
    "Origin": "https://tilda.ru",
    "Referer": "https://tilda.ru/projects/",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
  };
  const cp = await fetch("https://tilda.ru/projects/submit/", {
    method: "POST", headers: baseHeaders,
    body: new URLSearchParams({ comm: "addnewpagedublicateexample", projectid: PROJECT_ID, examplepageid: "1231", folderid: "", csrf: "" }),
  });
  const pageId = (await cp.text()).trim();
  console.log(`  created page ${pageId}`);
  const ab = await fetch("https://tilda.ru/page/submit/", {
    method: "POST", headers: baseHeaders,
    body: new URLSearchParams({ comm: "addnewrecord", pageid: pageId, tplid: "396", with_code: "yes" }),
  });
  const html = (await ab.json()).html;
  const recordId = html.match(/id="record(\d+)"/)?.[1];
  console.log(`  added Zero Block recordid=${recordId}`);
  return { pageId, recordId };
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

async function main() {
  const cookieHeader = await loadCookieHeader();
  if (!cookieHeader) throw new Error("no cookies");

  console.log("[setup] create page + add zero block");
  const { pageId, recordId } = await setupViaXhr(cookieHeader);

  // Now open browser at the Zero Block editor
  const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US", timezoneId: "Europe/Berlin", storageState: STATE_PATH,
  });
  const network = [];
  context.on("request", (req) => {
    const u = req.url();
    if (!u.match(/tilda\.(cc|ru)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico)\b/)) return;
    network.push({ phase: "req", method: req.method(), url: u, postData: req.postData() });
  });
  context.on("response", async (res) => {
    const req = res.request();
    const u = req.url();
    if (!u.match(/tilda\.(cc|ru)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico)\b/)) return;
    let body = null;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("json") || ct.includes("text") || ct.includes("javascript")) {
        body = (await res.body()).toString("utf8").slice(0, 1500);
      }
    } catch {}
    network.push({ phase: "res", url: u, status: res.status(), body });
  });
  const page = await context.newPage();
  page.on("dialog", async (d) => { console.log(`  DIALOG: ${d.message().substring(0, 100)}`); await d.accept(); });

  console.log(`[1] try common Zero Block editor URL patterns`);
  const candidates = [
    `https://tilda.ru/page/zero/?recordid=${recordId}`,
    `https://tilda.ru/page/zero/?pageid=${pageId}&recordid=${recordId}`,
    `https://tilda.ru/zero/?recordid=${recordId}`,
    `https://tilda.ru/zero/?pageid=${pageId}&recordid=${recordId}`,
  ];

  for (const url of candidates) {
    console.log(`  try ${url}`);
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(e => ({ ok: () => false, status: () => `err:${e.message.substring(0,40)}` }));
    const finalUrl = page.url();
    const title = await page.title().catch(() => "?");
    console.log(`    final=${finalUrl} status=${resp?.status?.()} title="${title.substring(0, 40)}"`);
    if (!finalUrl.includes("login") && !finalUrl.includes("not_published") && resp?.status?.() === 200) {
      console.log(`    OK — looks like a real editor view`);
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      await jitter(2000, 3000);
      await dump(page, `80_zero_editor_${url.replace(/[^a-z0-9]/gi, "_").slice(0, 30)}`);
      break;
    }
  }

  // Also: try opening main page editor → click into ZB
  console.log(`\n[2] open main editor and try to enter ZB by double-click record`);
  await page.goto(`https://tilda.ru/page/?pageid=${pageId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('text="Настройки"', { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) {
    await page.keyboard.press("Escape");
    await jitter(500, 1000);
  }
  await dump(page, "81_main_editor_with_zb");

  // Look at the ZB record's DOM in the page editor to find an "Edit Zero Block" affordance
  console.log("[3] probe record DOM for Edit / Редактировать affordance");
  const probe = await page.evaluate((rid) => {
    const rec = document.getElementById(`record${rid}`);
    if (!rec) return { found: false };
    const out = [];
    // walk up to find any control bar
    const parent = rec.closest('.r, .t-rec, [class*="rec"]')?.parentElement;
    const controls = parent?.querySelectorAll('[onclick], a, button, [class*="edit" i]');
    controls?.forEach(el => {
      const text = (el.innerText || el.textContent || '').trim().slice(0, 60);
      const cls = (el.className || '').toString().slice(0, 80);
      const oc = el.getAttribute('onclick')?.slice(0, 120) ?? '';
      if (text || oc) out.push({ text, cls, onclick: oc });
    });
    // Also peek global fns for ZB
    const fns = [];
    for (const k of Object.keys(window)) {
      try {
        if (typeof (window)[k] === "function" && /zero|tn[_-]?atom|zb[_-]?edit/i.test(k)) fns.push(k);
      } catch {}
    }
    return { found: true, controlsCount: out.length, controls: out.slice(0, 15), fns: fns.slice(0, 20) };
  }, recordId);
  console.log("  probe:", JSON.stringify(probe, null, 2));

  // Try the common td__editZB / window.editZeroBlock pattern
  console.log("[4] try window.td__editZB / editZeroBlock / opentnZB by name");
  const tryFns = ["td__editZB", "editZeroBlock", "tn_open_record", "tn__openRec", "tn_open"];
  for (const fn of tryFns) {
    const r = await page.evaluate(({ fn, rid, pid }) => {
      if (typeof window[fn] !== "function") return { fn, exists: false };
      try {
        const r = window[fn](rid, pid);
        return { fn, exists: true, ret: String(r).slice(0, 100) };
      } catch (e) {
        return { fn, exists: true, err: String(e).slice(0, 150) };
      }
    }, { fn, rid: recordId, pid: pageId });
    console.log("  ", r);
  }

  writeFileSync(join(OUT_DIR, "explore8_network.json"), JSON.stringify(network, null, 2));

  // Cleanup — delete this test page so we don't accumulate
  console.log(`\n[cleanup] delete page ${pageId}`);
  await fetch("https://tilda.ru/projects/submit/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": cookieHeader,
      "Origin": "https://tilda.ru",
      "Referer": "https://tilda.ru/projects/",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams({ comm: "delpage", pageid: pageId, csrf: "" }),
  });
  await context.close(); await browser.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
