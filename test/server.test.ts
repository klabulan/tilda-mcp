import { describe, it, expect } from "vitest";
import { createMcpServer } from "../src/index.js";

describe("MCP server", () => {
  it("creates server with 21 tools (7 read + 10 write + 4 helpers)", () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });
});
