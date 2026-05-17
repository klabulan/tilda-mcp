import { z } from "zod";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface Template {
  tplid: string;
  code: string;
  title: string;
  descr: string;
  category: string;
  has_bg: boolean;
}

let CACHE: Template[] | null = null;
function load(): Template[] {
  if (CACHE) return CACHE;
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/tools/read/listBlockTemplates.js → ../../data/tilda_templates.json
  const dataPath = join(here, "..", "..", "data", "tilda_templates.json");
  CACHE = JSON.parse(readFileSync(dataPath, "utf8")) as Template[];
  return CACHE;
}

export const listBlockTemplatesSchema = z.object({
  category: z.string().nullable().optional().describe(
    "Filter by category. Common: cover, text, form, popup, menu, footer, gallery, image, video, columns, features, testimonials, store, social, slider, about, process. Pass null/omit for all."
  ),
  search: z.string().nullable().optional().describe(
    "Free-text search across title, descr, code (case-insensitive). E.g. 'subscribe', 'обложка', 'BF20'."
  ),
  limit: z.number().int().min(1).max(806).optional().describe("Max items to return (default 50)."),
});

export async function handleListBlockTemplates(params: z.infer<typeof listBlockTemplatesSchema>): Promise<string> {
  let all = load();
  if (params.category) {
    const c = params.category.toLowerCase();
    all = all.filter(t => t.category === c);
  }
  if (params.search) {
    const q = params.search.toLowerCase();
    all = all.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.descr.toLowerCase().includes(q) ||
      t.code.toLowerCase().includes(q) ||
      t.tplid.includes(q)
    );
  }
  const limit = params.limit ?? 50;
  const truncated = all.length > limit;
  const items = all.slice(0, limit).map(t => ({
    tplid: t.tplid,
    code: t.code,
    title: t.title,
    descr: t.descr,
    category: t.category,
    add_block_type: `T${t.tplid.padStart(3, "0")}`,
  }));
  return JSON.stringify({
    matched: all.length,
    returned: items.length,
    truncated,
    items,
    hint: truncated ? `Returned first ${limit}; refine with category or search to narrow.` : undefined,
  }, null, 2);
}
