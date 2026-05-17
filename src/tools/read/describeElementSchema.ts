import { z } from "zod";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let CACHE: Record<string, unknown> | null = null;
function load(): Record<string, unknown> {
  if (CACHE) return CACHE;
  const here = dirname(fileURLToPath(import.meta.url));
  const dataPath = join(here, "..", "..", "data", "zeroblock_element_schemas.json");
  CACHE = JSON.parse(readFileSync(dataPath, "utf8")) as Record<string, unknown>;
  return CACHE;
}

export const describeElementSchemaSchema = z.object({
  elem_type: z.string().nullable().optional().describe(
    "Zero Block element type. One of: text, button, shape, image, video, html, tooltip, form, gallery, vector. "
    + "Omit/null → return all schemas + the _doc common-fields explanation."
  ),
});

export async function handleDescribeElementSchema(params: z.infer<typeof describeElementSchemaSchema>): Promise<string> {
  const all = load();
  if (!params.elem_type) {
    return JSON.stringify(all, null, 2);
  }
  const t = params.elem_type.toLowerCase();
  if (!(t in all)) {
    return JSON.stringify({
      error: `unknown elem_type "${t}"`,
      available: Object.keys(all).filter(k => !k.startsWith("_")),
    }, null, 2);
  }
  return JSON.stringify({
    _common: (all as Record<string, unknown>)._doc,
    [t]: all[t],
  }, null, 2);
}
