import { AppError } from "../errors.js";
import { readGoogleDoc, writeGoogleDoc } from "../google/docs.js";
import {
  extractGoogleDocSyncTemplate,
  extractManagedBlock,
  readNote,
  writeNote
} from "../obsidian/notes.js";

const SYNC_METADATA_COMMENT_PATTERN =
  /^<!-- google-doc-(?:ssot|sync):[^\n]*-->\n?/gm;

function buildSyncedBlock(doc) {
  return [
    `<!-- google-doc-sync:source-url=${doc.sourceUrl} -->`,
    `<!-- google-doc-sync:synced-at=${doc.fetchedAt} -->`,
    `<!-- google-doc-sync:direction=google_doc_to_obsidian -->`,
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

function buildComparableDocContent(doc) {
  return buildSyncedBlock(doc).replace(SYNC_METADATA_COMMENT_PATTERN, "").trim();
}

function splitIntoLines(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").trim();
  return normalized ? normalized.split("\n") : [];
}

function buildLineDiffOperations(obsidianLines, googleDocLines) {
  const obsidianLength = obsidianLines.length;
  const googleDocLength = googleDocLines.length;
  const dp = Array.from({ length: obsidianLength + 1 }, () =>
    Array(googleDocLength + 1).fill(0)
  );

  for (let row = obsidianLength - 1; row >= 0; row -= 1) {
    for (let column = googleDocLength - 1; column >= 0; column -= 1) {
      if (obsidianLines[row] === googleDocLines[column]) {
        dp[row][column] = dp[row + 1][column + 1] + 1;
      } else {
        dp[row][column] = Math.max(dp[row + 1][column], dp[row][column + 1]);
      }
    }
  }

  const operations = [];
  let row = 0;
  let column = 0;

  while (row < obsidianLength && column < googleDocLength) {
    if (obsidianLines[row] === googleDocLines[column]) {
      operations.push({
        type: "equal",
        line: obsidianLines[row]
      });
      row += 1;
      column += 1;
      continue;
    }

    if (dp[row + 1][column] >= dp[row][column + 1]) {
      operations.push({
        type: "remove",
        line: obsidianLines[row]
      });
      row += 1;
      continue;
    }

    operations.push({
      type: "add",
      line: googleDocLines[column]
    });
    column += 1;
  }

  while (row < obsidianLength) {
    operations.push({
      type: "remove",
      line: obsidianLines[row]
    });
    row += 1;
  }

  while (column < googleDocLength) {
    operations.push({
      type: "add",
      line: googleDocLines[column]
    });
    column += 1;
  }

  return operations;
}

export function summarizeLineDiff({
  obsidianContent,
  googleDocContent,
  obsidianBlockExists
}) {
  const obsidianLines = splitIntoLines(obsidianContent);
  const googleDocLines = splitIntoLines(googleDocContent);
  const operations = buildLineDiffOperations(obsidianLines, googleDocLines);
  const hunks = [];
  let currentHunk = null;
  let obsidianLineNumber = 1;
  let googleDocLineNumber = 1;
  let commonLineCount = 0;
  let obsidianOnlyLineCount = 0;
  let googleDocOnlyLineCount = 0;

  function finalizeHunk() {
    if (!currentHunk) {
      return;
    }

    hunks.push({
      obsidianStartLine: currentHunk.obsidianStartLine,
      obsidianEndLine:
        currentHunk.obsidianLines.length > 0
          ? currentHunk.obsidianStartLine + currentHunk.obsidianLines.length - 1
          : null,
      googleDocStartLine: currentHunk.googleDocStartLine,
      googleDocEndLine:
        currentHunk.googleDocLines.length > 0
          ? currentHunk.googleDocStartLine + currentHunk.googleDocLines.length - 1
          : null,
      obsidianPreview: currentHunk.obsidianLines.slice(0, 5),
      googleDocPreview: currentHunk.googleDocLines.slice(0, 5)
    });
    currentHunk = null;
  }

  for (const operation of operations) {
    if (operation.type === "equal") {
      commonLineCount += 1;
      finalizeHunk();
      obsidianLineNumber += 1;
      googleDocLineNumber += 1;
      continue;
    }

    if (!currentHunk) {
      currentHunk = {
        obsidianStartLine: obsidianLineNumber,
        googleDocStartLine: googleDocLineNumber,
        obsidianLines: [],
        googleDocLines: []
      };
    }

    if (operation.type === "remove") {
      obsidianOnlyLineCount += 1;
      currentHunk.obsidianLines.push(operation.line);
      obsidianLineNumber += 1;
      continue;
    }

    googleDocOnlyLineCount += 1;
    currentHunk.googleDocLines.push(operation.line);
    googleDocLineNumber += 1;
  }

  finalizeHunk();

  const exactMatch =
    obsidianBlockExists &&
    obsidianOnlyLineCount === 0 &&
    googleDocOnlyLineCount === 0;
  const comparisonStatus = exactMatch
    ? "match"
    : !obsidianBlockExists
      ? "managed-block-missing"
      : "different";

  return {
    exactMatch,
    comparisonStatus,
    obsidianBlockExists,
    obsidianLineCount: obsidianLines.length,
    googleDocLineCount: googleDocLines.length,
    commonLineCount,
    obsidianOnlyLineCount,
    googleDocOnlyLineCount,
    differingHunkCount: hunks.length,
    hunks
  };
}

async function syncGoogleDocToObsidian({ notePath, note, source, template }) {
  const doc = await readGoogleDoc(source);
  const previousManagedContent = extractManagedBlock(
    note.text,
    template.startMarker,
    template.endMarker
  );
  const nextManagedContent = buildSyncedBlock(doc);
  const changeSummary = detectChangeType(
    previousManagedContent,
    nextManagedContent.replace(SYNC_METADATA_COMMENT_PATTERN, "").trim()
  );

  const writeResult = writeNote({
    notePath,
    body: nextManagedContent,
    mode: "replace_between_markers",
    startMarker: template.startMarker,
    endMarker: template.endMarker,
    heading: template.heading
  });

  return {
    notePath: writeResult.notePath,
    sourceUrl: doc.sourceUrl,
    sourceId: doc.sourceId,
    title: doc.title,
    direction: "google_doc_to_obsidian",
    changeType: changeSummary.changeType,
    appendedTextPreview: changeSummary.appendedText.slice(0, 500),
    syncedAt: doc.fetchedAt,
    bytesWritten: writeResult.bytesWritten,
    preservedManualContent: true
  };
}

async function syncObsidianToGoogleDoc({ note, source, template }) {
  const managedBlock = extractManagedBlock(
    note.text,
    template.startMarker,
    template.endMarker
  );

  if (managedBlock === null) {
    throw new AppError(
      "TARGET_NOT_FOUND",
      "No managed sync block was found in the Obsidian note."
    );
  }

  const writeResult = await writeGoogleDoc({
    source,
    markdown: managedBlock
  });

  return {
    notePath: note.absolutePath,
    sourceUrl: writeResult.sourceUrl,
    sourceId: writeResult.sourceId,
    title: writeResult.title,
    direction: "obsidian_to_google_doc",
    syncedAt: writeResult.fetchedAt,
    requestCount: writeResult.requestCount,
    blockCount: writeResult.blockCount,
    characterCount: writeResult.characterCount,
    syncedBlockPreview: managedBlock.slice(0, 500),
    preservedManualContent: true
  };
}

async function compareGoogleDocAndObsidian({ note, source, template }) {
  const doc = await readGoogleDoc(source);
  const obsidianManagedBlock = extractManagedBlock(
    note.text,
    template.startMarker,
    template.endMarker
  );
  const comparableDocContent = buildComparableDocContent(doc);
  const comparison = summarizeLineDiff({
    obsidianContent: obsidianManagedBlock ?? "",
    googleDocContent: comparableDocContent,
    obsidianBlockExists: obsidianManagedBlock !== null
  });

  return {
    notePath: note.absolutePath,
    sourceUrl: doc.sourceUrl,
    sourceId: doc.sourceId,
    title: doc.title,
    direction: "compare_only",
    comparedAt: doc.fetchedAt,
    changeType: detectChangeType(
      obsidianManagedBlock ?? "",
      comparableDocContent
    ).changeType,
    comparison,
    obsidianPreview: (obsidianManagedBlock ?? "").slice(0, 500),
    googleDocPreview: comparableDocContent.slice(0, 500),
    modifiedTargets: [],
    preservedManualContent: true
  };
}

export function resolveGoogleDocSyncRequest({ noteText, source, direction }) {
  const template = extractGoogleDocSyncTemplate(noteText, {
    sourceUrl: source?.url,
    direction
  });
  const resolvedSource =
    source?.url || source?.id
      ? source
      : template.sourceUrl
        ? { url: template.sourceUrl }
        : null;

  if (!resolvedSource) {
    throw new AppError(
      "TARGET_NOT_FOUND",
      "No Google Doc sync URL was found in the Obsidian note."
    );
  }

  return {
    template,
    resolvedSource
  };
}

export async function syncGoogleDocTemplateNote(options) {
  const { notePath, source, direction } = options;
  const note = readNote(notePath);

  if (!note.exists) {
    throw new AppError("NOT_FOUND", "Obsidian note was not found.", {
      details: { notePath: note.absolutePath }
    });
  }

  const { template, resolvedSource } = resolveGoogleDocSyncRequest({
    noteText: note.text,
    source,
    direction
  });

  if (template.direction === "obsidian_to_google_doc") {
    return syncObsidianToGoogleDoc({
      note,
      source: resolvedSource,
      template
    });
  }

  if (template.direction === "compare_only") {
    return compareGoogleDocAndObsidian({
      note,
      source: resolvedSource,
      template
    });
  }

  return syncGoogleDocToObsidian({
    notePath,
    note,
    source: resolvedSource,
    template
  });
}

export async function syncGoogleDocSsotNote(options) {
  return syncGoogleDocTemplateNote(options);
}
