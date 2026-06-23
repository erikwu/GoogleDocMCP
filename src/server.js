import { McpServer, StdioServerTransport, z } from "./vendor.js";
import {
  runGoogleDocRead,
  runGoogleSheetRead,
  runObsidianNoteWrite,
  runObsidianSyncGoogleDocSsot
} from "./tools.js";

function toToolResult(result) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ],
    structuredContent: result
  };
}

export function createServer() {
  const server = new McpServer({
    name: "google-workspace-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "google_doc_read",
    {
      description: "Read a Google Doc and return normalized markdown/plain text.",
      inputSchema: {
        source: z
          .object({
            url: z.string().optional(),
            id: z.string().optional()
          })
          .describe("Google Doc source, via url or id.")
      }
    },
    async (args) => toToolResult(await runGoogleDocRead(args))
  );

  server.registerTool(
    "google_sheet_read",
    {
      description:
        "Read a Google Sheet and return normalized rows, markdown, and plain text.",
      inputSchema: {
        source: z
          .object({
            url: z.string().optional(),
            id: z.string().optional(),
            sheet: z.string().optional(),
            gid: z.union([z.string(), z.number()]).optional(),
            range: z.string().optional()
          })
          .describe(
            "Google Sheet source, via url or id, optionally with sheet/tab, gid, and A1 range."
          )
      }
    },
    async (args) => toToolResult(await runGoogleSheetRead(args))
  );

  server.registerTool(
    "obsidian_note_write",
    {
      description:
        "Write to an Obsidian note by replacing it, appending, or updating a managed marker block.",
      inputSchema: {
        note_path: z.string().describe("Absolute path or vault-relative note path."),
        body: z.string().describe("Content to write into the note."),
        mode: z
          .enum(["replace", "append", "replace_between_markers"])
          .default("replace"),
        start_marker: z.string().optional(),
        end_marker: z.string().optional(),
        heading: z.string().optional()
      }
    },
    async (args) => toToolResult(await runObsidianNoteWrite(args))
  );

  server.registerTool(
    "obsidian_sync_google_doc_ssot",
    {
      description:
        "Read the Google Doc SSOT URL from an Obsidian note, fetch the latest Google Doc content, and update only the managed sync block while preserving manual note content.",
      inputSchema: {
        note_path: z.string().describe("Absolute path or vault-relative note path."),
        source: z
          .object({
            url: z.string().optional()
          })
          .optional()
      }
    },
    async (args) => toToolResult(await runObsidianSyncGoogleDocSsot(args))
  );

  return server;
}

export async function startServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
