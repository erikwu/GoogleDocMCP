import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadVendor(name, specifiers) {
  for (const specifier of specifiers) {
    try {
      return require(specifier);
    } catch {
      continue;
    }
  }

  throw new Error(
    `Unable to load ${name}. Tried: ${specifiers.join(", ")}`
  );
}

export const { McpServer } = loadVendor("MCP SDK", [
  "@modelcontextprotocol/sdk/server/mcp",
  "/opt/homebrew/lib/node_modules/openclaw/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js"
]);

export const { StdioServerTransport } = loadVendor("MCP stdio transport", [
  "@modelcontextprotocol/sdk/server/stdio",
  "/opt/homebrew/lib/node_modules/openclaw/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js"
]);

export const z = loadVendor("zod", [
  "zod/v4",
  "/opt/homebrew/lib/node_modules/openclaw/node_modules/zod/v4/index.cjs"
]);
