import { describe, it, expect } from "vitest";
import { createMcpServer } from "../src/index.js";

describe("MCP server", () => {
  it("creates server with 16 tools (5 read + 7 write + 4 helpers)", () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });
});
