import { loadConfig } from "../config.js";
import { log } from "../logging.js";
import type { WriteTransport } from "./writeTransport.js";
import { PlaywrightTransport } from "./playwright/index.js";
import { XhrTransport } from "./xhr/index.js";

let activeTransport: WriteTransport | null = null;
let consecutiveFailures = 0;

export async function getWriteTransport(): Promise<WriteTransport> {
  if (activeTransport) return activeTransport;
  const cfg = loadConfig();
  const t = await instantiate(cfg.transport === "auto" ? "playwright" : cfg.transport);
  await t.init();
  activeTransport = t;
  return t;
}

export async function reportTransportFailure(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.transport !== "auto") return;
  consecutiveFailures += 1;
  if (consecutiveFailures >= cfg.autoFailoverThreshold && activeTransport) {
    log(
      "warn",
      "transport.factory",
      `Playwright failed ${consecutiveFailures}× in a row → failing over to XHR for the rest of the process lifetime.`
    );
    await activeTransport.dispose().catch(() => undefined);
    activeTransport = await instantiate("xhr");
    await activeTransport.init();
  }
}

export function resetFailureCounter(): void {
  consecutiveFailures = 0;
}

async function instantiate(mode: "playwright" | "xhr"): Promise<WriteTransport> {
  return mode === "playwright" ? new PlaywrightTransport() : new XhrTransport();
}

export async function disposeTransport(): Promise<void> {
  if (activeTransport) {
    await activeTransport.dispose().catch(() => undefined);
    activeTransport = null;
  }
}
