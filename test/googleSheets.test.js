import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGoogleSheetPayload } from "../src/google/sheets.js";

test("normalizeGoogleSheetPayload returns markdown and structured rows", () => {
  const normalized = normalizeGoogleSheetPayload({
    metadataPayload: {
      properties: {
        title: "Weekly Review"
      },
      sheets: [
        {
          properties: {
            sheetId: 0,
            title: "Summary",
            index: 0,
            gridProperties: {
              rowCount: 100,
              columnCount: 12
            }
          }
        }
      ]
    },
    valuesPayload: {
      range: "'Summary'!A1:B2",
      values: [
        ["Owner", "Status"],
        ["Erik", "On Track"]
      ]
    },
    requestedRange: "'Summary'!A1:B2",
    sourceUrl: "https://docs.google.com/spreadsheets/d/test-sheet-id/edit#gid=0",
    targetSheet: {
      sheetId: "0",
      title: "Summary",
      index: 0,
      gridProperties: {
        rowCount: 100,
        columnCount: 12
      }
    }
  });

  assert.equal(normalized.title, "Weekly Review");
  assert.equal(normalized.sheetTitle, "Summary");
  assert.equal(normalized.sheetId, "0");
  assert.equal(normalized.requestedRange, "'Summary'!A1:B2");
  assert.equal(normalized.returnedRange, "'Summary'!A1:B2");
  assert.equal(normalized.rowCount, 2);
  assert.equal(normalized.columnCount, 2);
  assert.match(normalized.markdown, /\| Column 1 \| Column 2 \|/);
  assert.match(normalized.markdown, /\| Erik \| On Track \|/);
  assert.equal(normalized.plainText, "Owner\tStatus\nErik\tOn Track");
  assert.deepEqual(normalized.rows, [
    ["Owner", "Status"],
    ["Erik", "On Track"]
  ]);
  assert.deepEqual(normalized.availableSheets, [
    {
      sheetId: "0",
      title: "Summary",
      index: 0,
      rowCount: 100,
      columnCount: 12
    }
  ]);
  assert.equal(
    normalized.sourceUrl,
    "https://docs.google.com/spreadsheets/d/test-sheet-id/edit#gid=0"
  );
});
