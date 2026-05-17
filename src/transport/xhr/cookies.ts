import { readFileSync, existsSync } from "node:fs";

interface StateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

interface StorageState {
  cookies: StateCookie[];
  origins: unknown[];
}

/**
 * Read Playwright-format storageState and produce a Cookie header value for
 * requests to a given host (e.g. "tilda.ru"). Only cookies whose `domain`
 * matches the host (suffix match) and which haven't expired are included.
 */
export function cookieHeaderForHost(stateFilePath: string, host: string): string {
  if (!existsSync(stateFilePath)) {
    throw new Error(`storageState not found at ${stateFilePath} — call login_headed_bootstrap first`);
  }
  const state: StorageState = JSON.parse(readFileSync(stateFilePath, "utf8"));
  const nowSec = Date.now() / 1000;
  const matches = state.cookies.filter((c) => {
    const cd = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
    const hostMatches = host === cd || host.endsWith(`.${cd}`);
    const notExpired = c.expires < 0 || c.expires > nowSec;
    return hostMatches && notExpired;
  });
  if (matches.length === 0) {
    throw new Error(`No valid cookies for ${host} in ${stateFilePath}`);
  }
  return matches.map((c) => `${c.name}=${c.value}`).join("; ");
}
