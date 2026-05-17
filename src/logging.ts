const REDACT_KEYS = /^(cookie|set-cookie|x-csrf-token|authorization|x-auth-token|publickey|secretkey|password|token|session|sessionid|csrf|api[_-]?key)$/i;
const REDACT_VALUE_PATTERNS: RegExp[] = [
  /sessionid=[A-Za-z0-9_\-]+/gi,
  /csrf[a-z_-]*=[A-Za-z0-9_\-]+/gi,
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /figd_[A-Za-z0-9]+/g,
];

const MAX_RING_BUFFER = 500;
const ringBuffer: string[] = [];

export function redact(input: unknown, depth = 6): unknown {
  if (depth < 0) return "[REDACT: depth-limit]";
  if (input == null) return input;
  if (typeof input === "string") {
    let out = input;
    for (const pat of REDACT_VALUE_PATTERNS) out = out.replace(pat, "[REDACTED]");
    return out;
  }
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((x) => redact(x, depth - 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = REDACT_KEYS.test(k) ? "[REDACTED]" : redact(v, depth - 1);
  }
  return out;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  tool: string | null;
  message: string;
  data?: unknown;
}

export function log(level: LogLevel, tool: string | null, message: string, data?: unknown): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    tool,
    message,
    data: data === undefined ? undefined : redact(data),
  };
  const line = JSON.stringify(entry);
  if (ringBuffer.length >= MAX_RING_BUFFER) ringBuffer.shift();
  ringBuffer.push(line);
  if (level !== "debug") {
    process.stderr.write(`[tilda-mcp] ${level.toUpperCase()} ${tool ?? "-"} ${message}\n`);
  }
}

export function dumpLog(tool: string | null, lines: number): string[] {
  let result = ringBuffer;
  if (tool) {
    result = ringBuffer.filter((l) => {
      try {
        return (JSON.parse(l) as LogEntry).tool === tool;
      } catch {
        return false;
      }
    });
  }
  return result.slice(-lines);
}
