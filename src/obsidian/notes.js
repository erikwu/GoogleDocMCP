import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config.js";
import { AppError } from "../errors.js";
import { extractGoogleDocUrls } from "../lib/googleLinks.js";

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---/;
const SYNC_METADATA_COMMENT_PATTERN =
  /^<!-- google-doc-(?:ssot|sync):[^\n]*-->\n?/gm;
const GOOGLE_DOC_SYNC_DIRECTION_ALIASES = new Map([
  ["google_doc_to_obsidian", "google_doc_to_obsidian"],
  ["google_primary", "google_doc_to_obsidian"],
  ["google", "google_doc_to_obsidian"],
  ["obsidian_to_google_doc", "obsidian_to_google_doc"],
  ["obsidian_primary", "obsidian_to_google_doc"],
  ["obsidian", "obsidian_to_google_doc"],
  ["compare_only", "compare_only"],
  ["compare", "compare_only"],
  ["diff_only", "compare_only"],
  ["compare_google_doc_and_obsidian", "compare_only"]
]);

function resolveNotePath(notePath) {
  if (!notePath || typeof notePath !== "string") {
    throw new AppError("INVALID_PATH", "note_path must be a non-empty string.");
  }

  if (path.isAbsolute(notePath)) {
    return notePath;
  }

  const vaultRoot = getConfig().obsidian.vaultRoot;
  if (!vaultRoot) {
    throw new AppError(
      "INVALID_PATH",
      "obsidian.vaultRoot is not configured; provide an absolute note_path."
    );
  }

  return path.join(vaultRoot, notePath);
}

export function readNote(notePath) {
  const absolutePath = resolveNotePath(notePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      absolutePath,
      exists: false,
      text: ""
    };
  }

  return {
    absolutePath,
    exists: true,
    text: fs.readFileSync(absolutePath, "utf8")
  };
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeBlockContent(blockContent) {
  return blockContent.replace(/\r\n/g, "\n").trimEnd();
}

function normalizeFrontmatterScalar(value) {
  return String(value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

export function parseFrontmatterFields(noteText) {
  const match = noteText.match(FRONTMATTER_PATTERN);
  if (!match) {
    return {};
  }

  const fields = {};
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = normalizeFrontmatterScalar(line.slice(separatorIndex + 1));
    if (!key || !value) {
      continue;
    }

    fields[key] = value;
  }

  return fields;
}

function normalizeGoogleDocSyncDirection(value) {
  if (!value) {
    return "google_doc_to_obsidian";
  }

  const normalizedKey = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  const direction = GOOGLE_DOC_SYNC_DIRECTION_ALIASES.get(normalizedKey);

  if (!direction) {
    throw new AppError(
      "INVALID_SOURCE",
      "Unsupported google_doc_sync_direction value.",
      {
        details: { value }
      }
    );
  }

  return direction;
}

export function extractGoogleDocSyncTemplate(noteText, overrides = {}) {
  const config = getConfig();
  const frontmatter = parseFrontmatterFields(noteText);
  const sourceUrl =
    overrides.sourceUrl ??
    frontmatter.google_doc_sync_url ??
    frontmatter.google_doc_ssot_url ??
    frontmatter.ssot_url ??
    frontmatter.source_url ??
    extractGoogleDocUrls(noteText)[0] ??
    null;

  return {
    sourceUrl,
    direction: normalizeGoogleDocSyncDirection(
      overrides.direction ??
        frontmatter.google_doc_sync_direction ??
        frontmatter.google_doc_sync_mode
    ),
    startMarker:
      overrides.startMarker ??
      frontmatter.google_doc_sync_start_marker ??
      config.sync.startMarker,
    endMarker:
      overrides.endMarker ??
      frontmatter.google_doc_sync_end_marker ??
      config.sync.endMarker,
    heading:
      overrides.heading ??
      frontmatter.google_doc_sync_heading ??
      config.sync.blockHeading
  };
}

export function upsertBlockBetweenMarkers(
  originalText,
  blockContent,
  options = {}
) {
  const {
    startMarker,
    endMarker,
    heading = "## Google Doc SSOT Sync"
  } = options;

  const normalizedBlock = normalizeBlockContent(blockContent);
  const blockWrapper = `${startMarker}\n${normalizedBlock}\n${endMarker}`;

  const startIndex = originalText.indexOf(startMarker);
  const endIndex = originalText.indexOf(endMarker);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = originalText.slice(0, startIndex);
    const after = originalText.slice(endIndex + endMarker.length);
    const leading = before.endsWith("\n") ? before : `${before}\n`;
    const trailing = after.startsWith("\n") ? after : `\n${after}`;

    return `${leading}${blockWrapper}${trailing}`.replace(/\n{3,}/g, "\n\n");
  }

  const trimmedOriginal = originalText.trimEnd();
  const pieces = [];

  if (trimmedOriginal) {
    pieces.push(trimmedOriginal);
  }

  if (heading) {
    pieces.push(heading);
  }

  pieces.push(blockWrapper);
  return `${pieces.join("\n\n")}\n`;
}

export function writeNote(options) {
  const {
    notePath,
    body,
    mode = "replace",
    startMarker,
    endMarker,
    heading
  } = options;

  const note = readNote(notePath);
  ensureParentDirectory(note.absolutePath);

  let nextText = "";
  if (mode === "replace") {
    nextText = body.endsWith("\n") ? body : `${body}\n`;
  } else if (mode === "append") {
    const separator =
      note.text.length === 0 || note.text.endsWith("\n\n") ? "" : "\n\n";
    nextText = `${note.text}${separator}${body}`;
    if (!nextText.endsWith("\n")) {
      nextText = `${nextText}\n`;
    }
  } else if (mode === "replace_between_markers") {
    if (!startMarker || !endMarker) {
      throw new AppError(
        "INVALID_WRITE_MODE",
        "replace_between_markers requires startMarker and endMarker."
      );
    }

    nextText = upsertBlockBetweenMarkers(note.text, body, {
      startMarker,
      endMarker,
      heading
    });
  } else {
    throw new AppError("INVALID_WRITE_MODE", "Unsupported note write mode.", {
      details: { mode }
    });
  }

  fs.writeFileSync(note.absolutePath, nextText, "utf8");
  return {
    notePath: note.absolutePath,
    existed: note.exists,
    bytesWritten: Buffer.byteLength(nextText, "utf8"),
    mode
  };
}

export function extractSsotUrl(noteText) {
  return extractGoogleDocSyncTemplate(noteText).sourceUrl;
}

export function extractManagedBlock(noteText, startMarker, endMarker) {
  const startIndex = noteText.indexOf(startMarker);
  const endIndex = noteText.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null;
  }

  return noteText
    .slice(startIndex + startMarker.length, endIndex)
    .trim()
    .replace(SYNC_METADATA_COMMENT_PATTERN, "")
    .trim();
}
