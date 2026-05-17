#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  getProjectsSchema, handleGetProjects,
  getProjectInfoSchema, handleGetProjectInfo,
  getPagesSchema, handleGetPages,
  getPageSchema, handleGetPage,
  getPageExportSchema, handleGetPageExport,
} from "./tools/read/pages.js";
import { createPageSchema, handleCreatePage } from "./tools/write/createPage.js";
import { setPageSettingsSchema, handleSetPageSettings } from "./tools/write/setPageSettings.js";
import { deletePageSchema, handleDeletePage } from "./tools/write/deletePage.js";
import { addBlockSchema, handleAddBlock } from "./tools/write/addBlock.js";
import { importZeroBlockSchema, handleImportZeroBlock } from "./tools/write/importZeroBlock.js";
import { editBlockSchema, handleEditBlock } from "./tools/write/editBlock.js";
import { publishSchema, handlePublish } from "./tools/write/publish.js";
import { healthCheckSchema, handleHealthCheck } from "./tools/helpers/healthCheck.js";
import { loginHeadedBootstrapSchema, handleLoginHeadedBootstrap } from "./tools/helpers/loginHeadedBootstrap.js";
import { resolveCaptchaInteractiveSchema, handleResolveCaptchaInteractive } from "./tools/helpers/resolveCaptchaInteractive.js";
import { dumpTransportLogSchema, handleDumpTransportLog } from "./tools/helpers/dumpTransportLog.js";
import { disposeTransport } from "./transport/factory.js";

const TOOL_COUNT = 16;

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "tilda-mcp",
    version: "1.1.1-fork.0",
  });

  // --- 5 read tools (preserved from upstream) ---
  server.tool("get_projects", "Список проектов Tilda.",
    getProjectsSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleGetProjects(p) }] }));

  server.tool("get_project_info", "Информация о проекте Tilda (домен, настройки, пути).",
    getProjectInfoSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleGetProjectInfo(p) }] }));

  server.tool("get_pages", "Список страниц проекта.",
    getPagesSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleGetPages(p) }] }));

  server.tool("get_page", "Полная информация о странице (HTML, CSS, JS).",
    getPageSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleGetPage(p) }] }));

  server.tool("get_page_export", "Экспорт страницы для самостоятельного хостинга.",
    getPageExportSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleGetPageExport(p) }] }));

  // --- 7 write tools (fork additions; XHR-RE transport against tilda.ru editor endpoints) ---
  server.tool("create_page", "Создать новую пустую страницу в проекте (template Blank).",
    createPageSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleCreatePage(p) }] }));

  server.tool("set_page_settings", "Установить title, descr (SEO), alias (URL-slug) страницы. Alias change требует republish.",
    setPageSettingsSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleSetPageSettings(p) }] }));

  server.tool("delete_page", "Удалить страницу безвозвратно. ВНИМАНИЕ: без soft-delete / корзины.",
    deletePageSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleDeletePage(p) }] }));

  server.tool("add_block", "Добавить T-блок (T396 = Zero Block, T123 = заголовок, и т.п.).",
    addBlockSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleAddBlock(p) }] }));

  server.tool("import_zeroblock", "Импортировать содержимое в Zero Block (STUB — endpoint TBD).",
    importZeroBlockSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleImportZeroBlock(p) }] }));

  server.tool("edit_block", "Изменить содержимое существующего блока (STUB — endpoint TBD).",
    editBlockSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleEditBlock(p) }] }));

  server.tool("publish", "Опубликовать страницу.",
    publishSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handlePublish(p) }] }));

  // --- 4 helpers ---
  server.tool("health_check", "Состояние read API + write transport + storageState.",
    healthCheckSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleHealthCheck(p) }] }));

  server.tool("login_headed_bootstrap", "Открыть headed Chromium для первого Tilda login → сохранить storageState.",
    loginHeadedBootstrapSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleLoginHeadedBootstrap(p) }] }));

  server.tool("resolve_captcha_interactive", "Pause + surface CAPTCHA для ручного решения. v0 STUB.",
    resolveCaptchaInteractiveSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleResolveCaptchaInteractive(p) }] }));

  server.tool("dump_transport_log", "Последние N записей transport log (с redaction).",
    dumpTransportLogSchema.shape,
    async (p) => ({ content: [{ type: "text", text: await handleDumpTransportLog(p) }] }));

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

  // Graceful shutdown to dispose Playwright browser
  const cleanup = async () => {
    await disposeTransport().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  if (httpMode) {
    await startHttpMode(port);
  } else {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[tilda-mcp@fork] Сервер запущен (stdio). ${TOOL_COUNT} инструментов (5 read + 7 write + 4 helpers).`);
  }
}

main().catch((error) => {
  console.error("[tilda-mcp] Ошибка:", error);
  process.exit(1);
});

export { createMcpServer };
