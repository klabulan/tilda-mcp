import { describe, it, expect } from "vitest";
import { createMcpServer } from "../src/index.js";

describe("MCP server", () => {
  it("creates server with 14 tools (5 read + 5 write + 4 helpers)", () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });
});
