import { z } from "zod";
import { getWriteTransport, reportTransportFailure, resetFailureCounter } from "../../transport/factory.js";
import { log } from "../../logging.js";

export const setSiteSettingsSchema = z.object({
  projectid: z.string().describe("Tilda project id (e.g. \"25668306\")"),
  patch: z.record(z.string()).describe(
    "Site-level field map. Known fields (send only what you want to change — Tilda merges with current):\n"
    + "  basic:       title, descr, alias, customdomain, indexpageid, headerpageid, footerpageid\n"
    + "  typography:  headlinefont, textfont, headlinefontweight, headlinefontsize, textfontweight, textfontsize, fontsswap, typekitid\n"
    + "  colors:      headlinecolor, textcolor, linkcolor, bgcolor (hex, e.g. '#ff5a4e')\n"
    + "  custom CSS:  customcssfile (URL — use upload_image to upload a .css file, then pass cdn_url here)\n"
    + "  custom JS:   customjsfile (URL — same path)\n"
    + "  favicon:     favicon (URL)\n"
    + "NOTE: Updating site settings does NOT auto-republish pages. Re-publish each affected page for the changes to land on CDN."
  ),
});

export async function handleSetSiteSettings(params: z.infer<typeof setSiteSettingsSchema>): Promise<string> {
  try {
    const t = await getWriteTransport();
    if (typeof t.setSiteSettings !== "function") throw new Error("active transport doesn't implement setSiteSettings");
    const result = await t.setSiteSettings(params.projectid, params.patch);
    resetFailureCounter();
    log("info", "set_site_settings", `Updated project ${params.projectid} (${Object.keys(params.patch).length} field(s))`);
    return JSON.stringify({
      ...result,
      hint: "Re-publish each page (publish tool) for changes to apply on the live URLs.",
    }, null, 2);
  } catch (e) {
    await reportTransportFailure();
    throw e;
  }
}
