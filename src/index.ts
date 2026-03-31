#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getProjectsSchema, handleGetProjects, getPagesSchema, handleGetPages, getPageSchema, handleGetPage } from "./tools/pages.js";

const server = new McpServer({
  name: "tilda-mcp",
  version: "1.0.0",
});

server.tool(
  "get_projects",
  "Получить список проектов Tilda.",
  getProjectsSchema.shape,
  async (params) => ({ content: [{ type: "text", text: await handleGetProjects(params) }] }),
);

server.tool(
  "get_pages",
  "Получить список страниц проекта Tilda.",
  getPagesSchema.shape,
  async (params) => ({ content: [{ type: "text", text: await handleGetPages(params) }] }),
);

server.tool(
  "get_page",
  "Получить полную информацию о странице Tilda (HTML, CSS, JS).",
  getPageSchema.shape,
  async (params) => ({ content: [{ type: "text", text: await handleGetPage(params) }] }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[tilda-mcp] Сервер запущен. 3 инструмента. Требуется TILDA_PUBLIC_KEY + TILDA_SECRET_KEY.");
}

main().catch((error) => {
  console.error("[tilda-mcp] Ошибка:", error);
  process.exit(1);
});
