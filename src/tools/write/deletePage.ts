import { z } from "zod";
import { getWriteTransport, reportTransportFailure, resetFailureCounter } from "../../transport/factory.js";
import { log } from "../../logging.js";

export const deletePageSchema = z.object({
  pageid: z.string().describe("Tilda page id. WARNING: deletion is NOT recoverable — no soft-delete / trash for full pages."),
});

export async function handleDeletePage(params: z.infer<typeof deletePageSchema>): Promise<string> {
  try {
    const t = await getWriteTransport();
    const result = await t.deletePage(params.pageid);
    resetFailureCounter();
    log("info", "delete_page", `Deleted page ${params.pageid}`);
    return JSON.stringify(result, null, 2);
  } catch (e) {
    await reportTransportFailure();
    throw e;
  }
}
