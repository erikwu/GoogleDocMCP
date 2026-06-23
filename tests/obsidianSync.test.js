import test from "node:test";
import assert from "node:assert/strict";
import {
  extractManagedBlock,
  extractSsotUrl,
  upsertBlockBetweenMarkers
} from "../src/obsidian/notes.js";

const START = "<!-- google-doc-ssot:start -->";
const END = "<!-- google-doc-ssot:end -->";

test("extractSsotUrl prefers frontmatter ssot url", () => {
  const url = extractSsotUrl(`---
google_doc_ssot_url: https://docs.google.com/document/d/doc123/edit
---

# Note`);

  assert.equal(url, "https://docs.google.com/document/d/doc123/edit");
});

test("upsertBlockBetweenMarkers preserves manual content outside managed block", () => {
  const original = `# My Note

Manual intro.

## Google Doc SSOT Sync

${START}
old
${END}

Manual outro.
`;

  const updated = upsertBlockBetweenMarkers(original, "new synced text", {
    startMarker: START,
    endMarker: END,
    heading: "## Google Doc SSOT Sync"
  });

  assert.match(updated, /Manual intro\./);
  assert.match(updated, /Manual outro\./);
  assert.match(updated, new RegExp(`${START}\\nnew synced text\\n${END}`));
});

test("extractManagedBlock strips metadata comments from managed block", () => {
  const note = `${START}
<!-- google-doc-ssot:source-url=https://docs.google.com/document/d/doc123/edit -->
<!-- google-doc-ssot:synced-at=2026-06-23T00:00:00Z -->
# Title

Body
${END}`;

  assert.equal(extractManagedBlock(note, START, END), "# Title\n\nBody");
});
