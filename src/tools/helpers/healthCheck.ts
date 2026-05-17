import { z } from "zod";
import { tildaGet } from "../../client.js";
import { getWriteTransport } from "../../transport/factory.js";
import { log } from "../../logging.js";
import type { TransportHealth } from "../../transport/writeTransport.js";

export const healthCheckSchema = z.object({});

export async function handleHealthCheck(_params: z.infer<typeof healthCheckSchema>): Promise<string> {
  let readStatus: TransportHealth["read_api"] = "ok";
  try {
    await tildaGet("getprojectslist");
  } catch (e) {
    const msg = (e as Error).message;
    if (/401|403/.test(msg)) readStatus = "auth_failed";
    else if (/429/.test(msg)) readStatus = "rate_limited";
    else readStatus = "unreachable";
  }

  let writeHealth: TransportHealth;
  try {
    const t = await getWriteTransport();
    writeHealth = await t.healthCheck();
    // overwrite read_api with our own probe above
    writeHealth.read_api = readStatus;
  } catch (e) {
    log("warn", "health_check", `Write transport init failed: ${(e as Error).message}`);
    writeHealth = {
      read_api: readStatus,
      write_transport: "playwright_session_expired",
      storage_state_age_days: -1,
      active_transport: "playwright",
    };
  }

  return JSON.stringify(writeHealth, null, 2);
}
