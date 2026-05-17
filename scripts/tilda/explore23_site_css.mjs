#!/usr/bin/env node
// Explore 23: open Tilda Site Settings → CSS tab → add custom CSS → save → capture endpoint.

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

  const submitCalls = [];
  context.on("response", async (res) => {
    const u = res.request().url();
    if (!u.match(/tilda\.(cc|ru)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico|js)\b/)) return;
    const pd = res.request().postData() || "";
    if (!pd.includes("comm=") || !u.includes("/submit")) return;
    let body = "";
    try { body = (await res.body()).toString("utf8").slice(0, 1500); } catch {}
    submitCalls.push({ url: u, status: res.status(), postData: pd.slice(0, 2000), body });
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { await d.accept(); });

  console.log("[1] open project view");
  await page.goto(`https://tilda.ru/projects/?projectid=${PROJECT_ID}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await jitter(3000, 5000);
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) { await page.keyboard.press("Escape"); await jitter(500, 1000); }
  await dump(page, "230_project");

  console.log("[2] click 'Настройки сайта' / 'Site Settings'");
  let opened = false;
  for (const text of ["Настройки сайта", "Site Settings", "Настройки"]) {
    const el = page.getByText(text, { exact: true });
    const c = await el.count();
    if (c > 0) {
      console.log(`  click '${text}' (count=${c})`);
      try {
        await el.first().click({ timeout: 5000 });
        opened = true;
        break;
      } catch (e) { console.log(`  click err: ${e.message.substring(0, 80)}`); }
    }
  }
  if (!opened) {
    // Fallback: try direct URL — Tilda has /projects/?projectid=N for site settings popup or /site/settings/
    console.log("  fallback: try direct settings URL");
    await page.goto(`https://tilda.ru/projects/sitesettings/?projectid=${PROJECT_ID}`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  }
  await jitter(3000, 5000);
  await dump(page, "231_settings_popup");

  console.log("[3] probe popup for tabs (Главное / SEO / CSS / Аналитика)");
  const tabs = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a, button, li, span, div').forEach(el => {
      const t = (el.innerText || el.textContent || "").trim();
      if (!t || t.length > 60) return;
      if (/CSS|JS|код|Скрипт|Analytics|анали[тз]ик|Аналит|Скрипты/i.test(t)) {
        out.push({ t, cls: (el.className || "").toString().slice(0, 80) });
      }
    });
    return out.slice(0, 40);
  });
  console.log("  tab candidates:");
  tabs.forEach(t => console.log(`    "${t.t}" cls="${t.cls.slice(0, 60)}"`));

  // Try clicking 'CSS' or 'Скрипты'
  console.log("[4] click CSS-related tab");
  for (const text of ["Вставка кода", "CSS-код", "CSS", "Custom CSS", "Аналитика и скрипты", "Скрипты"]) {
    const el = page.getByText(text, { exact: true });
    if (await el.count() > 0) {
      try {
        console.log(`  click '${text}'`);
        await el.first().click({ timeout: 4000 });
        await jitter(2000, 3000);
        break;
      } catch {}
    }
  }
  await dump(page, "232_css_tab");

  console.log("[5] find code/textarea + fill");
  const NEW_CSS = "/* MCP test CSS — captured */ body.mcp-test { background: linear-gradient(45deg, #ff5a4e, #4e8bff); }";
  const taSelectors = ['textarea[name*="css" i]', 'textarea[name="customcss"]', 'textarea#sitescript', 'textarea[name*="script" i]', '.td-popup-window textarea'];
  for (const s of taSelectors) {
    if (await page.locator(s).count()) {
      try { await page.locator(s).first().fill(NEW_CSS, { timeout: 3000 }); console.log(`  filled ${s}`); break; } catch {}
    }
  }
  await jitter(500, 1500);

  console.log("[6] click Save");
  const preSave = submitCalls.length;
  for (const s of ['input.js-ps-popup-submit', 'input[value="Сохранить изменения"]', 'input.td-popup-btn', 'button:has-text("Сохранить")']) {
    if (await page.locator(s).count()) {
      try { await page.locator(s).first().click({ timeout: 3000 }); console.log(`  clicked ${s}`); break; } catch {}
    }
  }
  await jitter(3000, 5000);

  console.log("[7] post-save submit calls:");
  submitCalls.slice(preSave).forEach((c, i) => {
    console.log(`  [${preSave + i}] ${c.status} ${c.url}`);
    console.log(`    post: ${c.postData.substring(0, 400)}`);
    if (c.body) console.log(`    body: ${c.body.substring(0, 200).replace(/\n/g, " ")}`);
  });

  writeFileSync(join(OUT_DIR, "explore23_submit.json"), JSON.stringify(submitCalls, null, 2));
  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
