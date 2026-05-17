import { homedir } from "node:os";
import { join } from "node:path";

export type TransportMode = "playwright" | "xhr" | "auto";

export interface Config {
  publicKey: string | undefined;
  secretKey: string | undefined;
  transport: TransportMode;
  autoFailoverThreshold: number;
  stateFilePath: string;
  allowPasswordEnv: boolean;
  humanDelay: boolean;
  email: string | undefined;
  password: string | undefined;
  timezoneId: string;
  locale: string;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): Config {
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  const defaultStatePath = join(xdg, "tilda-mcp", "state.json");

  return {
    publicKey: process.env.TILDA_PUBLIC_KEY ?? process.env.TILDA_PUBLICKEY,
    secretKey: process.env.TILDA_SECRET_KEY ?? process.env.TILDA_SECRETKEY,
    transport: (process.env.TILDA_MCP_TRANSPORT as TransportMode | undefined) ?? "playwright",
    autoFailoverThreshold: envInt("TILDA_MCP_AUTO_FAILOVER_THRESHOLD", 3),
    stateFilePath: process.env.TILDA_MCP_STATE_PATH ?? defaultStatePath,
    allowPasswordEnv: envBool("TILDA_MCP_ALLOW_PASSWORD_ENV", false),
    humanDelay: envBool("TILDA_MCP_HUMAN_DELAY", true),
    email: process.env.TILDA_EMAIL,
    password: process.env.TILDA_PASSWORD,
    timezoneId: process.env.TILDA_MCP_TIMEZONE ?? "Europe/Berlin",
    locale: process.env.TILDA_MCP_LOCALE ?? "en-US",
  };
}
