#!/usr/bin/env node
// Explore 18: query addElem__getDefaultParametersByElementType for every known element type.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PAGE_ID = process.env.PAGE_ID ?? "142153516";
const RECORD_ID = process.env.RECORD_ID ?? "2278559111";

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US", timezoneId: "Europe/Berlin", slowMo: 100,
  });
  const fs = await import("node:fs");
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  await context.addCookies(state.cookies.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires,
    httpOnly: !!c.httpOnly, secure: !!c.secure,
    sameSite: c.sameSite === "Lax" ? "Lax" : c.sameSite === "None" ? "None" : c.sameSite === "Strict" ? "Strict" : "Lax",
  })));

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { await d.accept(); });

  console.log("[1] open ZB editor");
  await page.goto(`https://tilda.ru/zero/?recordid=${RECORD_ID}&pageid=${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 4000));

  console.log("[2] query default schemas for all element types");
  const types = ["text", "image", "shape", "button", "video", "html", "tooltip", "form", "gallery", "vector"];
  const schemas = await page.evaluate((types) => {
    const out = {};
    const fn = window.addElem__getDefaultParametersByElementType;
    if (typeof fn !== "function") return { err: "fn not found" };
    for (const t of types) {
      try { out[t] = fn(t); } catch (e) { out[t] = { __err: String(e).slice(0, 200) }; }
    }
    return out;
  }, types);

  console.log("\n=== default schemas ===");
  for (const [t, s] of Object.entries(schemas)) {
    console.log(`\n--- ${t} ---`);
    console.log(JSON.stringify(s, null, 2));
  }

  // Also: look at addElem__getDefaultBgColor — color palette
  const colors = await page.evaluate(() => {
    if (typeof window.addElem__getColor !== "function") return null;
    const names = ["yellow", "orange", "white", "lightgray", "black", "red", "green", "blue"];
    const out = {};
    for (const n of names) { try { out[n] = window.addElem__getColor(n); } catch {} }
    return out;
  });
  console.log("\n--- color palette ---");
  console.log(JSON.stringify(colors, null, 2));

  writeFileSync(join(OUT_DIR, "explore18_default_schemas.json"), JSON.stringify({ schemas, colors }, null, 2));
  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
