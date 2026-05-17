import { z } from "zod";
import { getWriteTransport, reportTransportFailure, resetFailureCounter } from "../../transport/factory.js";
import { log } from "../../logging.js";

export const importZeroBlockSchema = z.object({
  pageid: z.string().describe("Tilda page id"),
  zero_block_json: z.unknown().describe(
    "Either {recordid: string, code: <ZB JSON>} OR a single ZB JSON object IF recordid passed separately. "
    + "Code schema: { \"0\": {elem_id, elem_type: 'text'|'shape'|'image', top, left, width, height, ...}, "
    + "  \"1\": {...}, ..., ab_height, ab_bgcolor, timestamp, meta: {feeds:{}} } "
    + "See src/transport/xhr/signatures/import_zeroblock.template.json for full field reference."
  ),
  position: z.number().int().nullable().optional().describe("(reserved — unused for now; ZB is replaced fully)"),
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
