import { z } from "zod";
import { getWriteTransport, reportTransportFailure, resetFailureCounter } from "../../transport/factory.js";

export const getZeroBlockSchema = z.object({
  pageid: z.string().describe("Tilda page id"),
  recordid: z.string().describe("Zero Block record id (returned by add_block when block_type=T396)"),
});

export async function handleGetZeroBlock(params: z.infer<typeof getZeroBlockSchema>): Promise<string> {
  try {
    const t = await getWriteTransport();
    if (typeof t.getZeroBlock !== "function") throw new Error("Active transport does not support getZeroBlock");
    const data = await t.getZeroBlock(params.pageid, params.recordid);
    resetFailureCounter();
    return JSON.stringify(data, null, 2);
  } catch (e) {
    await reportTransportFailure();
    throw e;
  }
}
