#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  getProjectsSchema, handleGetProjects,
  getProjectInfoSchema, handleGetProjectInfo,
  getPagesSchema, handleGetPages,
  getPageSchema, handleGetPage,
  getPageExportSchema, handleGetPageExport,
} from "./tools/pages.js";

const TOOL_COUNT = 5;

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "tilda-mcp",
    version: "1.1.0",
  });

  server.tool(
    "get_projects",
    "Получить список проектов Tilda.",
    getProjectsSchema.shape,
    async (params) => ({ content: [{ type: "text", text: await handleGetProjects(params) }] }),
  );

  server.tool(
    "get_project_info",
    "Получить подробную информацию о проекте Tilda (домен, настройки, CSS/JS).",
    getProjectInfoSchema.shape,
    async (params) => ({ content: [{ type: "text", text: await handleGetProjectInfo(params) }] }),
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

  server.tool(
    "get_page_export",
    "Экспортировать страницу Tilda — HTML, CSS, JS, изображения для самостоятельного хостинга.",
    getPageExportSchema.shape,
    async (params) => ({ content: [{ type: "text", text: await handleGetPageExport(params) }] }),
  );

  return server;
}

async function startHttpMode(port: number) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const { createServer } = await import("node:http");

  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
  await server.connect(transport);

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", tools: TOOL_COUNT }));
      return;
    }

    if (url.pathname === "/mcp") {
      // Parse body for POST requests
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        await transport.handleRequest(req, res, body);
      } else {
        await transport.handleRequest(req, res);
      }
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  httpServer.listen(port, () => {
    console.error(`[tilda-mcp] HTTP mode on :${port}/mcp — ${TOOL_COUNT} tools`);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const httpMode = args.includes("--http");
  const portIdx = args.indexOf("--port");
  const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3001;

  if (httpMode) {
    await startHttpMode(port);
  } else {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[tilda-mcp] Сервер запущен (stdio). ${TOOL_COUNT} инструментов. Требуется TILDA_PUBLIC_KEY + TILDA_SECRET_KEY.`);
  }
}

main().catch((error) => {
  console.error("[tilda-mcp] Ошибка:", error);
  process.exit(1);
});

export { createMcpServer };
