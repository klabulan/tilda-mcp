import { z } from "zod";
import { getWriteTransport, reportTransportFailure, resetFailureCounter } from "../../transport/factory.js";
import { log } from "../../logging.js";

export const importZeroBlockSchema = z.object({
  pageid: z.string().describe("Tilda page id"),
  zero_block_json: z.unknown().describe("Zero Block JSON produced by figma-extractor (schema TBD in t02)"),
  position: z.number().int().nullable().optional().describe("0-based insertion index; null/omit → append"),
});

export async function handleImportZeroBlock(params: z.infer<typeof importZeroBlockSchema>): Promise<string> {
  try {
    const t = await getWriteTransport();
    const result = await t.importZeroBlock(params.pageid, params.zero_block_json, params.position ?? null);
    resetFailureCounter();
    log("info", "import_zeroblock", `Imported Zero Block ${result.block_id} on page ${params.pageid}`);
    return JSON.stringify(result, null, 2);
  } catch (e) {
    await reportTransportFailure();
    throw e;
  }
}
