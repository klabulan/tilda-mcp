#!/usr/bin/env node
// Explore 15: enumerate available animation types, programmatically apply one to an element,
// trigger save, capture how it appears in saved JSON.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PAGE_ID = process.env.PAGE_ID ?? "142152986";
const RECORD_ID = process.env.RECORD_ID ?? "2278551161";

async function jitter(min, max) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }

async function main() {
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
  await context.addInitScript(() => {
    Object.defineProperty(Object.getPrototypeOf(navigator), "webdriver", { get: () => undefined });
    if (!window.chrome) window.chrome = { runtime: {} };
  });

  const zeroCalls = [];
  context.on("response", async (res) => {
    const u = res.request().url();
    if (!u.includes("/zero/")) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico|js)\b/)) return;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("json") || ct.includes("text") || ct.includes("javascript")) {
        const full = (await res.body()).toString("utf8");
        zeroCalls.push({ url: u, status: res.status(), postData: res.request().postData() || "", body: full.slice(0, 30_000) });
      }
    } catch {}
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { console.log(`  DIALOG: ${d.message().substring(0, 100)}`); await d.accept(); });

  console.log(`[1] open ZB editor`);
  await page.goto(`https://tilda.ru/zero/?recordid=${RECORD_ID}&pageid=${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);

  console.log("[2] call animation__getAnimationTypes()");
  const types = await page.evaluate(() => {
    if (typeof window.animation__getAnimationTypes !== "function") return null;
    try { return window.animation__getAnimationTypes(); } catch (e) { return { err: String(e) }; }
  });
  console.log("  types:", JSON.stringify(types, null, 2));

  console.log("\n[3] dump source of animation/anim relevant fns (truncated)");
  for (const fn of ["animation__getAnimationTypes", "animation__updateAnimationSection", "elem__hoverIn", "control__drawUi__setAnimSelectOptions"]) {
    const src = await page.evaluate((f) => {
      if (typeof window[f] !== "function") return null;
      return window[f].toString().slice(0, 600);
    }, fn);
    console.log(`\n  --- ${fn} ---`);
    console.log(`  ${src || "<missing>"}`);
  }

  console.log("\n[4] examine current element data — look for any anim/effect already there");
  const data = await page.evaluate(() => {
    // tn library typically stores current data in a global
    const candidates = ["tn_zerocode", "tn_data", "tn", "tn_currentdata", "zerocode"];
    const out = {};
    for (const k of candidates) {
      try {
        const v = window[k];
        if (v) out[k] = (typeof v === "object" ? Object.keys(v).slice(0, 30) : String(v).slice(0, 80));
      } catch {}
    }
    return out;
  });
  console.log("  globals:", JSON.stringify(data, null, 2));

  writeFileSync(join(OUT_DIR, "explore15_zero_calls.txt"), zeroCalls.map(z => `=== ${z.url} (${z.status}) ===\nPOST:\n${z.postData}\n\nBODY:\n${z.body}`).join("\n\n---\n\n"));
  console.log("\n[5] keep window open 5s");
  await new Promise(r => setTimeout(r, 5000));
  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
