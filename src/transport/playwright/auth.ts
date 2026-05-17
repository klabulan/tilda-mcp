import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { loadConfig } from "../../config.js";
import { log } from "../../logging.js";

const STATE_TTL_DAYS = 14;

export async function bootstrapHeadedLogin(email?: string | null, statePath?: string | null): Promise<{
  state_path: string;
  saved_at: string;
  hint: string;
}> {
  const cfg = loadConfig();
  const targetPath = statePath ?? cfg.stateFilePath;
  const targetDir = dirname(targetPath);
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });

  log("info", "login_headed_bootstrap", `Launching headed Chromium for first-time Tilda login → ${targetPath}`);

  const browser: Browser = await chromium.launch({ headless: false });
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: cfg.locale,
    timezoneId: cfg.timezoneId,
  });

  const page = await context.newPage();
  await page.goto("https://tilda.cc/login/");

  if (email) {
    await page.fill('input[name="email"]', email).catch(() => undefined);
  }

  process.stderr.write(
    "\n[tilda-mcp] Headed login window opened.\n" +
      "  1. Complete login in the browser (email, password, 2FA if any, CAPTCHA if any).\n" +
      "  2. Wait until you see your project list at https://tilda.cc/projects/.\n" +
      "  3. Press Enter here to save session state and close the window.\n\n"
  );

  await waitForEnter();

  await context.storageState({ path: targetPath });
  // Ensure 0600
  try {
    const { chmodSync } = await import("node:fs");
    chmodSync(targetPath, 0o600);
  } catch (e) {
    log("warn", "login_headed_bootstrap", `chmod 600 failed: ${(e as Error).message}`);
  }

  await browser.close();

  const savedAt = new Date().toISOString();
  log("info", "login_headed_bootstrap", `Session state saved at ${targetPath}`);

  return {
    state_path: targetPath,
    saved_at: savedAt,
    hint: "Storage state saved. Subsequent MCP calls run headless. Re-bootstrap when session expires (~14 days).",
  };
}

export function stateAgeDays(statePath: string): number {
  if (!existsSync(statePath)) return -1;
  const mtime = statSync(statePath).mtime.getTime();
  return (Date.now() - mtime) / (1000 * 60 * 60 * 24);
}

export function stateIsStale(statePath: string): boolean {
  const age = stateAgeDays(statePath);
  return age < 0 || age > STATE_TTL_DAYS;
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const onData = () => {
      process.stdin.off("data", onData);
      try {
        process.stdin.pause();
      } catch {
        /* ignore */
      }
      resolve();
    };
    process.stdin.resume();
    process.stdin.once("data", onData);
  });
}
