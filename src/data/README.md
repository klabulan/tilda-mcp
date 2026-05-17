# `src/data/`

Bundled data files queried by MCP tools at runtime.

## `tilda_templates.json`

Snapshot of Tilda's T-block library — all 806 templates with `tplid`, `code` (CR01, BF201N, …), `title`, `descr`, derived `category`, `has_bg`.

**Source:** `https://tilda.ru/page/tplslistjs/?lang=ru` (`window.$tpls` array).

**Refresh:** `npm run refresh:templates` (runs `scripts/refresh_templates.mjs`). Run periodically (Tilda adds new templates).

**Consumed by:** the `list_block_templates` MCP tool.

**Categories** (derived from `code` 2-letter prefix + title keywords):

| Category | Prefix | Notes |
|---|---|---|
| cover | CR | Hero / cover blocks |
| text | TX | Text blocks |
| form | BF | Forms / subscriptions |
| popup | (title match) | Modal popups |
| menu | ME | Navigation, hamburgers |
| footer | FT | Page footers |
| gallery | GL | Image galleries |
| image | IM | Standalone images |
| video | VD | Video blocks |
| columns | CL | Column / card layouts |
| features | FR | Feature lists |
| testimonials | TS | Reviews |
| store | ST | Product cards / ecommerce |
| social | SM | Social plugins |
| slider | TE | Sliders / carousels |
| index | IX | Table of contents |
| quote | QT | Quotes |
| about | AB | About-section |
| process | PR | Step-by-step / process |
| other | – | Anything that didn't match |
