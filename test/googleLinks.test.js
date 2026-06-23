import assert from "node:assert/strict";
import test from "node:test";

import {
  parseGoogleSheetUrl,
  resolveGoogleSheetSource
} from "../src/lib/googleLinks.js";

test("parseGoogleSheetUrl extracts spreadsheet id, gid, and range", () => {
  const parsed = parseGoogleSheetUrl(
    "https://docs.google.com/spreadsheets/d/test-sheet-id/edit#gid=456&range=A1:C5"
  );

  assert.equal(parsed.spreadsheetId, "test-sheet-id");
  assert.equal(
    parsed.canonicalUrl,
    "https://docs.google.com/spreadsheets/d/test-sheet-id/edit#gid=456"
  );
  assert.equal(parsed.gid, "456");
  assert.equal(parsed.range, "A1:C5");
});

test("resolveGoogleSheetSource merges url state with explicit fields", () => {
  const resolved = resolveGoogleSheetSource({
    url: "https://docs.google.com/spreadsheets/d/test-sheet-id/edit#gid=456",
    range: "B2:D8"
  });

  assert.deepEqual(resolved, {
    spreadsheetId: "test-sheet-id",
    sourceUrl: "https://docs.google.com/spreadsheets/d/test-sheet-id/edit#gid=456",
    gid: "456",
    sheetName: null,
    range: "B2:D8"
  });
});

test("resolveGoogleSheetSource rejects mismatched spreadsheet id", () => {
  assert.throws(
    () =>
      resolveGoogleSheetSource({
        url: "https://docs.google.com/spreadsheets/d/test-sheet-id/edit",
        id: "another-id"
      }),
    /do not match/
  );
});
