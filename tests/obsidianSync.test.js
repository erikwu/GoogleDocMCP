import test from "node:test";
import assert from "node:assert/strict";
import {
  extractGoogleDocSyncTemplate,
  extractManagedBlock,
  extractSsotUrl,
  parseFrontmatterFields,
  upsertBlockBetweenMarkers
} from "../src/obsidian/notes.js";
import {
  resolveGoogleDocSyncRequest,
  summarizeLineDiff
} from "../src/sync/googleDocSsot.js";

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

test("parseFrontmatterFields reads google doc sync template fields", () => {
  const fields = parseFrontmatterFields(`---
google_doc_sync_url: "https://docs.google.com/document/d/doc123/edit"
google_doc_sync_direction: obsidian_to_google_doc
google_doc_sync_start_marker: "<!-- sync:start -->"
google_doc_sync_end_marker: "<!-- sync:end -->"
google_doc_sync_heading: "## Sync Block"
---

# Note`);

  assert.equal(
    fields.google_doc_sync_url,
    "https://docs.google.com/document/d/doc123/edit"
  );
  assert.equal(fields.google_doc_sync_direction, "obsidian_to_google_doc");
  assert.equal(fields.google_doc_sync_start_marker, "<!-- sync:start -->");
  assert.equal(fields.google_doc_sync_end_marker, "<!-- sync:end -->");
  assert.equal(fields.google_doc_sync_heading, "## Sync Block");
});

test("extractGoogleDocSyncTemplate resolves direction and marker overrides", () => {
  const template = extractGoogleDocSyncTemplate(`---
google_doc_sync_url: https://docs.google.com/document/d/doc456/edit
google_doc_sync_direction: google_primary
google_doc_sync_start_marker: <!-- google-doc-sync:start -->
google_doc_sync_end_marker: <!-- google-doc-sync:end -->
---

# Note`);

  assert.equal(
    template.sourceUrl,
    "https://docs.google.com/document/d/doc456/edit"
  );
  assert.equal(template.direction, "google_doc_to_obsidian");
  assert.equal(template.startMarker, "<!-- google-doc-sync:start -->");
  assert.equal(template.endMarker, "<!-- google-doc-sync:end -->");
});

test("extractGoogleDocSyncTemplate resolves compare-only aliases", () => {
  const template = extractGoogleDocSyncTemplate(`---
google_doc_sync_url: https://docs.google.com/document/d/doc999/edit
google_doc_sync_direction: compare_google_doc_and_obsidian
---

# Note`);

  assert.equal(
    template.sourceUrl,
    "https://docs.google.com/document/d/doc999/edit"
  );
  assert.equal(template.direction, "compare_only");
});

test("resolveGoogleDocSyncRequest preserves obsidian_to_google_doc from note template", () => {
  const resolved = resolveGoogleDocSyncRequest({
    noteText: `---
google_doc_sync_url: https://docs.google.com/document/d/doc789/edit
google_doc_sync_direction: obsidian_to_google_doc
---

# Note

<!-- google-doc-sync:start -->
Body
<!-- google-doc-sync:end -->`
  });

  assert.equal(
    resolved.resolvedSource.url,
    "https://docs.google.com/document/d/doc789/edit"
  );
  assert.equal(resolved.template.direction, "obsidian_to_google_doc");
});

test("resolveGoogleDocSyncRequest preserves compare_only from note template", () => {
  const resolved = resolveGoogleDocSyncRequest({
    noteText: `---
google_doc_sync_url: https://docs.google.com/document/d/doc321/edit
google_doc_sync_direction: compare_only
---

# Note

<!-- google-doc-sync:start -->
Body
<!-- google-doc-sync:end -->`
  });

  assert.equal(
    resolved.resolvedSource.url,
    "https://docs.google.com/document/d/doc321/edit"
  );
  assert.equal(resolved.template.direction, "compare_only");
});

test("summarizeLineDiff reports exact matches for identical content", () => {
  const comparison = summarizeLineDiff({
    obsidianContent: "# Title\n\nLine A\nLine B",
    googleDocContent: "# Title\n\nLine A\nLine B",
    obsidianBlockExists: true
  });

  assert.equal(comparison.exactMatch, true);
  assert.equal(comparison.comparisonStatus, "match");
  assert.equal(comparison.obsidianOnlyLineCount, 0);
  assert.equal(comparison.googleDocOnlyLineCount, 0);
  assert.equal(comparison.differingHunkCount, 0);
});

test("summarizeLineDiff reports missing managed block without modifying content", () => {
  const comparison = summarizeLineDiff({
    obsidianContent: "",
    googleDocContent: "# Title\n\nLine A\nLine B",
    obsidianBlockExists: false
  });

  assert.equal(comparison.exactMatch, false);
  assert.equal(comparison.comparisonStatus, "managed-block-missing");
  assert.equal(comparison.obsidianBlockExists, false);
  assert.equal(comparison.obsidianLineCount, 0);
  assert.equal(comparison.googleDocLineCount, 4);
  assert.equal(comparison.commonLineCount, 0);
  assert.equal(comparison.obsidianOnlyLineCount, 0);
  assert.equal(comparison.googleDocOnlyLineCount, 4);
  assert.equal(comparison.differingHunkCount, 1);
  assert.deepEqual(comparison.hunks[0].googleDocPreview, [
    "# Title",
    "",
    "Line A",
    "Line B"
  ]);
});
