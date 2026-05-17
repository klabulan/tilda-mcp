import { z } from "zod";
import { getWriteTransport, reportTransportFailure, resetFailureCounter } from "../../transport/factory.js";
import { log } from "../../logging.js";

export const editBlockSchema = z.object({
  blockid: z.string().describe("Tilda block (record) id — value returned by add_block"),
  patch: z.record(z.unknown()).describe(
    "Patch object. MUST include `pageid` (page that owns the block) plus any field=value pairs to update. "
    + "Field names depend on the T-block schema. Examples: "
    + "T0868 HTML popup → {pageid, code: '<div>...</div>', linkhook: '#mypopup'}. "
    + "Use a Zero Block? Don't — call import_zeroblock instead. "
    + "Tilda silently ignores unknown fields. Use this for non-ZB blocks (forms, popups, headers, etc.)."
  ),
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
