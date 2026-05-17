#!/usr/bin/env node
// Explore 9: open Zero Block editor, add a text element, save. Capture all XHRs.

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
    "Cookie": cookieHeader,
    "Origin": "https://tilda.ru",
    "Referer": "https://tilda.ru/projects/",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  };
  const cp = await fetch("https://tilda.ru/projects/submit/", {
    method: "POST", headers: baseHeaders,
    body: new URLSearchParams({ comm: "addnewpagedublicateexample", projectid: PROJECT_ID, examplepageid: "1231", folderid: "", csrf: "" }),
  });
  const pageId = (await cp.text()).trim();
  const ab = await fetch("https://tilda.ru/page/submit/", {
    method: "POST", headers: baseHeaders,
    body: new URLSearchParams({ comm: "addnewrecord", pageid: pageId, tplid: "396", with_code: "yes" }),
  });
  const raw = (await ab.text()).replace(/^<!--tlp-->\s*/, "");
  const data = JSON.parse(raw);
  const html = data.html;
  const recordId = html.match(/id="record(\d+)"/)?.[1];
  return { pageId, recordId };
}

async function deletePage(cookieHeader, pageId) {
  await fetch("https://tilda.ru/projects/submit/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookieHeader, "Origin": "https://tilda.ru", "Referer": "https://tilda.ru/projects/", "X-Requested-With": "XMLHttpRequest" },
    body: new URLSearchParams({ comm: "delpage", pageid: pageId, csrf: "" }),
  });
}

async function main() {
  const cookieHeader = await loadCookieHeader();
  console.log("[setup] create page + ZB");
  const { pageId, recordId } = await setupViaXhr(cookieHeader);
  console.log(`  page=${pageId} record=${recordId}`);

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

  console.log(`[1] open ZB editor`);
  await page.goto(`https://tilda.ru/zero/?recordid=${recordId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);
  await dump(page, "90_zb_editor_loaded");

  console.log("[2] probe DOM for add-element controls");
  const probe = await page.evaluate(() => {
    const out = { buttons: [], fns: [], inputs: [] };
    // Look for "add element" / "add text" / "+" controls
    document.querySelectorAll('[onclick], .tn-action, .tn-toolbar__item, [class*="add" i], [class*="tn-" i][class*="btn" i]').forEach(el => {
      const text = (el.innerText || el.textContent || '').trim().slice(0, 80);
      const cls = (el.className || '').toString().slice(0, 100);
      const oc = el.getAttribute('onclick')?.slice(0, 150) ?? '';
      const title = el.getAttribute('title') ?? '';
      if (text || oc || title) out.buttons.push({ text, cls, onclick: oc, title });
    });
    for (const k of Object.keys(window)) {
      try {
        if (typeof (window)[k] === "function" && /tn[_-]?(add|create|insert|save|update)|zb[_-]?(add|save)|atom[_-]?(add|create)/i.test(k)) {
          out.fns.push(k);
        }
      } catch {}
    }
    return out;
  });
  console.log(`  buttons: ${probe.buttons.length}`);
  probe.buttons.slice(0, 20).forEach(b => console.log(`    "${b.text}" title="${b.title}" cls="${b.cls.slice(0, 50)}" oc="${b.onclick.slice(0, 80)}"`));
  console.log(`  add/save fns:`, probe.fns.slice(0, 30));

  // Save what we have and exit; we'll do follow-up interactions after analysis.
  writeFileSync(join(OUT_DIR, "explore9_network.json"), JSON.stringify(network, null, 2));

  // Cleanup
  console.log(`\n[cleanup] delete page ${pageId}`);
  await deletePage(cookieHeader, pageId);
  await context.close(); await browser.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
