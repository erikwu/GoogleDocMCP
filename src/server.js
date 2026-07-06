import { McpServer, StdioServerTransport, z } from "./vendor.js";
import {
  runGoogleDocRead,
  runGoogleDocWrite,
  runGoogleSheetRead,
  runGoogleSlideApplySheetMappings,
  runGoogleSlideRead,
  runGoogleSlideWrite,
  runObsidianSyncGoogleDoc,
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
    "google_doc_write",
    {
      description:
        "Overwrite a Google Doc body from markdown/plain text content.",
      inputSchema: {
        source: z
          .object({
            url: z.string().optional(),
            id: z.string().optional()
          })
          .describe("Google Doc source, via url or id."),
        markdown: z.string().optional(),
        text: z.string().optional(),
        dry_run: z.boolean().optional()
      }
    },
    async (args) => toToolResult(await runGoogleDocWrite(args))
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
    "google_slide_read",
    {
      description:
        "Read a Google Slide presentation and return normalized slide text, markdown, and page-element metadata.",
      inputSchema: {
        source: z
          .object({
            url: z.string().optional(),
            id: z.string().optional()
          })
          .describe("Google Slide source, via url or id.")
      }
    },
    async (args) => toToolResult(await runGoogleSlideRead(args))
  );

  server.registerTool(
    "google_slide_write",
    {
      description:
        "Update specific Google Slide content by placeholder replacement, shape text replacement, or table-cell text replacement.",
      inputSchema: {
        source: z
          .object({
            url: z.string().optional(),
            id: z.string().optional()
          })
          .describe("Google Slide source, via url or id."),
        operations: z
          .array(
            z.object({
              mode: z.enum([
                "replace_all_text",
                "replace_shape_text",
                "replace_table_cell_text"
              ]),
              match_text: z.string().optional(),
              replace_text: z.string().optional(),
              object_id: z.string().optional(),
              text: z.string().optional(),
              slide_number: z.number().int().positive().optional(),
              slide_object_id: z.string().optional(),
              match_case: z.boolean().optional(),
              row_index: z.number().int().nonnegative().optional(),
              column_index: z.number().int().nonnegative().optional()
            })
          )
          .min(1)
          .describe("One or more Google Slide write operations."),
        write_control: z
          .object({
            required_revision_id: z.string().optional()
          })
          .optional(),
        dry_run: z.boolean().optional()
      }
    },
    async (args) => toToolResult(await runGoogleSlideWrite(args))
  );

  server.registerTool(
    "google_slide_apply_sheet_mappings",
    {
      description:
        "Read a Google Sheet mapping table, then use it to update a Google Slide presentation.",
      inputSchema: {
        presentation: z
          .object({
            url: z.string().optional(),
            id: z.string().optional()
          })
          .describe("Google Slide source, via url or id."),
        sheet: z
          .object({
            url: z.string().optional(),
            id: z.string().optional(),
            sheet: z.string().optional(),
            gid: z.union([z.string(), z.number()]).optional(),
            range: z.string().optional()
          })
          .describe(
            "Google Sheet source, via url or id, optionally with sheet/tab, gid, and A1 range."
          ),
        mapping: z
          .object({
            header_row: z.number().int().positive().optional(),
            mode_column: z.string().optional(),
            placeholder_column: z.string().optional(),
            value_column: z.string().optional(),
            slide_column: z.string().optional(),
            object_id_column: z.string().optional(),
            text_column: z.string().optional(),
            enabled_column: z.string().optional(),
            match_case_column: z.string().optional(),
            default_match_case: z.boolean().optional()
          })
          .optional(),
        write_control: z
          .object({
            required_revision_id: z.string().optional()
          })
          .optional(),
        dry_run: z.boolean().optional()
      }
    },
    async (args) => toToolResult(await runGoogleSlideApplySheetMappings(args))
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
        "Legacy alias for Obsidian/Google Doc sync. It follows the note template direction and defaults to Google Doc -> Obsidian when no direction is configured.",
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

  server.registerTool(
    "obsidian_sync_google_doc",
    {
      description:
        "Read the Google Doc sync template from an Obsidian note and either sync the managed block or compare differences, depending on the configured direction.",
      inputSchema: {
        note_path: z.string().describe("Absolute path or vault-relative note path."),
        source: z
          .object({
            url: z.string().optional(),
            id: z.string().optional()
          })
          .optional(),
        direction: z
          .enum([
            "google_doc_to_obsidian",
            "obsidian_to_google_doc",
            "compare_only"
          ])
          .optional()
      }
    },
    async (args) => toToolResult(await runObsidianSyncGoogleDoc(args))
  );

  return server;
}

export async function startServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
