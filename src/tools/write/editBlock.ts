import { z } from "zod";
import { getWriteTransport, reportTransportFailure, resetFailureCounter } from "../../transport/factory.js";
import { log } from "../../logging.js";

export const editBlockSchema = z.object({
  blockid: z.string().describe("Tilda block id"),
  patch: z.unknown().describe("Block-type-specific field map; Zero Block: {elements: [...]}; T-block: {settings, content}"),
});

export async function handleEditBlock(params: z.infer<typeof editBlockSchema>): Promise<string> {
  try {
    const t = await getWriteTransport();
    await t.editBlock(params.blockid, params.patch);
    resetFailureCounter();
    log("info", "edit_block", `Edited block ${params.blockid}`);
    return JSON.stringify({ success: true }, null, 2);
  } catch (e) {
    await reportTransportFailure();
    throw e;
  }
}
