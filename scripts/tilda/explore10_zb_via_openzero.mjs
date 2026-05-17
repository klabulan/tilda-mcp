#!/usr/bin/env node
// Explore 10: open ZB editor properly via window.tp__openZero(recordid) from main editor.

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
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  };
  const cp = await fetch("https://tilda.ru/projects/submit/", { method: "POST", headers: baseHeaders, body: new URLSearchParams({ comm: "addnewpagedublicateexample", projectid: PROJECT_ID, examplepageid: "1231", folderid: "", csrf: "" }) });
  const pageId = (await cp.text()).trim();
  const ab = await fetch("https://tilda.ru/page/submit/", { method: "POST", headers: baseHeaders, body: new URLSearchParams({ comm: "addnewrecord", pageid: pageId, tplid: "396", with_code: "yes" }) });
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
  const { pageId, recordId } = await setupViaXhr(cookieHeader);
  console.log(`page=${pageId} record=${recordId}`);

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

  // Listen for new pages (tp__openZero may open in new tab)
  let newPage = page;
  context.on("page", async (p) => {
    console.log(`  >>> new tab opened: ${p.url()}`);
    newPage = p;
  });

  console.log("[1] open main editor");
  await page.goto(`https://tilda.ru/page/?pageid=${pageId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('text="Настройки"', { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) {
    await page.keyboard.press("Escape");
    await jitter(500, 1000);
  }

  console.log(`[2] call tp__openZero(${recordId})`);
  const preZ = network.length;
  const r = await page.evaluate((rid) => {
    if (typeof window.tp__openZero !== "function") return { err: "tp__openZero not a function" };
    try {
      const out = window.tp__openZero(rid);
      return { ok: true, ret: String(out).slice(0, 150) };
    } catch (e) {
      return { ok: false, err: String(e).slice(0, 200) };
    }
  }, recordId);
  console.log("  result:", r);
  await jitter(6000, 9000);

  // active page might be the new tab; check both
  console.log("[3] state after openZero");
  console.log(`  page1 url: ${page.url()}`);
  console.log(`  newPage url: ${newPage.url()}`);
  await dump(page, "100_after_openzero_main");
  if (newPage !== page) {
    await dump(newPage, "101_after_openzero_zb");
  }

  console.log("[4] post-open network:");
  network.slice(preZ).forEach((n, i) => {
    if (n.phase === "req" && n.method !== "GET") {
      console.log(`  [${preZ + i}] REQ ${n.method} ${n.url}`);
      if (n.postData) console.log(`        body: ${n.postData.substring(0, 200)}`);
    }
  });

  writeFileSync(join(OUT_DIR, "explore10_network.json"), JSON.stringify(network, null, 2));

  console.log(`\n[cleanup] delete page ${pageId}`);
  await deletePage(cookieHeader, pageId);
  await context.close(); await browser.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
