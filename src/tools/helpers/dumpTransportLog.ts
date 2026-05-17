import { z } from "zod";
import { dumpLog } from "../../logging.js";

export const dumpTransportLogSchema = z.object({
  tool: z.string().nullable().optional().describe("Filter to entries from one tool (e.g. \"add_block\")"),
  lines: z.number().int().min(1).max(500).optional().describe("How many trailing entries to return; default 200"),
});

export async function handleDumpTransportLog(params: z.infer<typeof dumpTransportLogSchema>): Promise<string> {
  const lines = dumpLog(params.tool ?? null, params.lines ?? 200);
  return JSON.stringify({ log: lines }, null, 2);
}
