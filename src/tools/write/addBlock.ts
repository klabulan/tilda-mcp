import { z } from "zod";
import { getWriteTransport, reportTransportFailure, resetFailureCounter } from "../../transport/factory.js";
import { log } from "../../logging.js";

export const addBlockSchema = z.object({
  pageid: z.string().describe("Tilda page id"),
  block_type: z.string().describe(
    "Tilda T-block code, e.g. 'T396' (Zero Block), 'T2441' (form), 'T1093' (popup with Zero Block). "
    + "Discover all 806 available templates by category or search via the `list_block_templates` tool — "
    + "do NOT guess block codes from memory."
  ),
  position: z.number().int().nullable().optional().describe("0-based insertion index; null/omit → append"),
});

export async function handleAddBlock(params: z.infer<typeof addBlockSchema>): Promise<string> {
  try {
    const t = await getWriteTransport();
    const result = await t.addBlock(params.pageid, params.block_type, params.position ?? null);
    resetFailureCounter();
    log("info", "add_block", `Added block ${result.block_id} (type=${params.block_type}) on page ${params.pageid}`);
    return JSON.stringify(result, null, 2);
  } catch (e) {
    await reportTransportFailure();
    throw e;
  }
}
