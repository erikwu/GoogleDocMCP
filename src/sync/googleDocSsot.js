import { getConfig } from "../config.js";
import { AppError } from "../errors.js";
import { readGoogleDoc } from "../google/docs.js";
import {
  extractManagedBlock,
  extractSsotUrl,
  readNote,
  writeNote
} from "../obsidian/notes.js";

function buildSyncedBlock(doc) {
  return [
    `<!-- google-doc-ssot:source-url=${doc.sourceUrl} -->`,
    `<!-- google-doc-ssot:synced-at=${doc.fetchedAt} -->`,
    `# ${doc.title}`,
    "",
    doc.markdown
  ]
    .join("\n")
    .trim();
}

function detectChangeType(previousContent, nextContent) {
  if (!previousContent) {
    return {
      changeType: "initial-sync",
      appendedText: nextContent
    };
  }

  if (previousContent === nextContent) {
    return {
      changeType: "no-change",
      appendedText: ""
    };
  }

  if (nextContent.startsWith(previousContent)) {
    return {
      changeType: "append-only",
      appendedText: nextContent.slice(previousContent.length).trim()
    };
  }

  return {
    changeType: "replace",
    appendedText: ""
  };
}

export async function syncGoogleDocSsotNote(options) {
  const { notePath, source } = options;
  const config = getConfig();
  const note = readNote(notePath);

  if (!note.exists) {
    throw new AppError("NOT_FOUND", "Obsidian note was not found.", {
      details: { notePath: note.absolutePath }
    });
  }

  const ssotUrl = source?.url ?? extractSsotUrl(note.text);
  if (!ssotUrl) {
    throw new AppError(
      "TARGET_NOT_FOUND",
      "No Google Doc SSOT URL was found in the Obsidian note."
    );
  }

  const doc = await readGoogleDoc({ url: ssotUrl });
  const previousManagedContent = extractManagedBlock(
    note.text,
    config.sync.startMarker,
    config.sync.endMarker
  );
  const nextManagedContent = buildSyncedBlock(doc);
  const changeSummary = detectChangeType(
    previousManagedContent,
    nextManagedContent.replace(/^<!-- google-doc-ssot:[^\n]*-->\n?/gm, "").trim()
  );

  const writeResult = writeNote({
    notePath,
    body: nextManagedContent,
    mode: "replace_between_markers",
    startMarker: config.sync.startMarker,
    endMarker: config.sync.endMarker,
    heading: config.sync.blockHeading
  });

  return {
    notePath: writeResult.notePath,
    sourceUrl: doc.sourceUrl,
    sourceId: doc.sourceId,
    title: doc.title,
    changeType: changeSummary.changeType,
    appendedTextPreview: changeSummary.appendedText.slice(0, 500),
    syncedAt: doc.fetchedAt,
    bytesWritten: writeResult.bytesWritten,
    preservedManualContent: true
  };
}
