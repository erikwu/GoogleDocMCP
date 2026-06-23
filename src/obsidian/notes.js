import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config.js";
import { AppError } from "../errors.js";
import { extractGoogleDocUrls } from "../lib/googleLinks.js";

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
  const frontmatterMatch = noteText.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const urlLine = frontmatterMatch[1]
      .split("\n")
      .map((line) => line.trim())
      .find(
        (line) =>
          line.startsWith("google_doc_ssot_url:") ||
          line.startsWith("ssot_url:") ||
          line.startsWith("source_url:")
      );

    if (urlLine) {
      const [, rawValue] = urlLine.split(/:\s+/, 2);
      if (rawValue) {
        return rawValue.trim().replace(/^['"]|['"]$/g, "");
      }
    }
  }

  return extractGoogleDocUrls(noteText)[0] ?? null;
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
    .replace(/^<!-- google-doc-ssot:[^\n]*-->\n?/gm, "")
    .trim();
}
