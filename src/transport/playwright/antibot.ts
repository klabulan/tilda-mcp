import type { BrowserContext, Page } from "playwright";
import { loadConfig } from "../../config.js";
import { selectors } from "./selectors.js";

const USER_AGENT_REALISTIC =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

export const launchArgs = ["--disable-blink-features=AutomationControlled"];

export async function applyAntibotInitScript(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // Hide webdriver flag — common automation detector
    Object.defineProperty(Object.getPrototypeOf(navigator), "webdriver", {
      get: () => undefined,
    });
    // Make sure window.chrome exists (Chromium does this, but be explicit)
    if (!(window as unknown as { chrome?: unknown }).chrome) {
      (window as unknown as { chrome: unknown }).chrome = { runtime: {} };
    }
  });
}

export function realisticContextOptions() {
  const cfg = loadConfig();
  return {
    userAgent: USER_AGENT_REALISTIC,
    viewport: { width: 1920, height: 1080 },
    locale: cfg.locale,
    timezoneId: cfg.timezoneId,
  } as const;
}

export async function humanDelay(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.humanDelay) return;
  const delay = 250 + Math.random() * 550;
  await new Promise((r) => setTimeout(r, delay));
}

export async function detectCaptcha(page: Page): Promise<boolean> {
  const count = await page.locator(selectors.editor.captchaIframe).count().catch(() => 0);
  return count > 0;
}
