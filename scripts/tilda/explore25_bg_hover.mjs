#!/usr/bin/env node
// Explore 25: capture artboard BG image field name + button hover field names.
// Approach: open ZB editor; programmatically simulate add+set via tn library helpers,
// or open Settings panel for an element, set hover color, save, capture full ZB JSON.

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

async function loadCookieHeader() {
  const fs = await import("node:fs");
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const now = Date.now() / 1000;
  return state.cookies
    .filter(c => (c.domain.startsWith(".") ? c.domain.slice(1) : c.domain) === "tilda.ru" || c.domain === ".tilda.ru")
    .filter(c => c.expires < 0 || c.expires > now)
    .map(c => `${c.name}=${c.value}`).join("; ");
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
  console.log(`page=${pageId} zb=${recordId}`);

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

  const zeroBodies = [];
  context.on("response", async (res) => {
    const u = res.request().url();
    if (!u.includes("/zero/")) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico|js)\b/)) return;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (!ct.includes("json") && !ct.includes("text") && !ct.includes("javascript")) return;
      const body = (await res.body()).toString("utf8");
      const pd = res.request().postData() || "";
      zeroBodies.push({ url: u, status: res.status(), postData: pd.slice(0, 200), body: body.slice(0, 8000) });
    } catch {}
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { await d.accept(); });

  console.log("[1] open ZB editor");
  await new Promise(r => setTimeout(r, 3000));
  await page.goto(`https://tilda.ru/zero/?recordid=${recordId}&pageid=${pageId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
  await jitter(4000, 6000);

  console.log("[2] enumerate artboard-setting fns + button hover state fns");
  const fns = await page.evaluate(() => {
    const out = [];
    for (const k of Object.keys(window)) {
      try {
        if (typeof window[k] === "function" && /(?:artboard__set|ab__set|artboard__update|ab__setBgImage|tn_setArtboard|hover|elem__createOnHoverEvent|state__hover|stateHover|hoverFields|control__updateHover)/i.test(k)) {
          out.push(k);
        }
      } catch {}
    }
    return out.sort();
  });
  console.log(`  ${fns.length} fns:`);
  fns.slice(0, 50).forEach(f => console.log(`    ${f}`));

  console.log("\n[3] dump tn.ab_fields keys (artboard schema known to Tilda)");
  const ab_fields = await page.evaluate(() => {
    const out = {};
    if (window.tn?.ab_fields) {
      out.ab_fields_keys = Object.keys(window.tn.ab_fields).slice(0, 80);
    }
    if (window.tn?.elemFields) {
      out.elemFields_keys = Object.keys(window.tn.elemFields).slice(0, 80);
    }
    return out;
  });
  console.log("  ab_fields keys:", JSON.stringify(ab_fields.ab_fields_keys, null, 2)?.slice(0, 2000));
  console.log("  elemFields keys:", JSON.stringify(ab_fields.elemFields_keys, null, 2)?.slice(0, 2000));

  console.log("\n[4] dump tn.ab_fields full + look for bg/image fields");
  const ab_image_fields = await page.evaluate(() => {
    const out = {};
    if (window.tn?.ab_fields) {
      for (const [k, v] of Object.entries(window.tn.ab_fields)) {
        if (/bg|image|img|background/i.test(k)) {
          out[k] = typeof v === "object" ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 80);
        }
      }
    }
    return out;
  });
  console.log("  artboard image fields:", JSON.stringify(ab_image_fields, null, 2));

  console.log("\n[5] dump button elemFields with hover");
  const hover_fields = await page.evaluate(() => {
    const out = {};
    if (window.tn?.elemFields?.button) {
      for (const [k, v] of Object.entries(window.tn.elemFields.button)) {
        if (/hover|state/i.test(k)) {
          out[k] = typeof v === "object" ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 80);
        }
      }
    }
    return out;
  });
  console.log("  button hover fields:", JSON.stringify(hover_fields, null, 2));

  writeFileSync(join(OUT_DIR, "explore25_zero_calls.txt"), zeroBodies.map(z => `=== ${z.url} (${z.status}) ===\nPOST: ${z.postData}\nBODY:\n${z.body}`).join("\n\n---\n\n"));

  console.log("\n[cleanup]");
  await deletePage(cookieHeader, pageId);
  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
