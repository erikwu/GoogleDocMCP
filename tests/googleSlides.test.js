import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSlideRequestsFromOperations,
  normalizeGoogleSlidePayload,
  planGoogleSlideSheetMappings
} from "../src/google/slides.js";

test("normalizeGoogleSlidePayload renders slide text, bullets, tables, and charts", () => {
  const normalized = normalizeGoogleSlidePayload({
    title: "Quarterly Review",
    revisionId: "rev-1",
    slides: [
      {
        objectId: "slide-1",
        pageElements: [
          {
            objectId: "shape-title",
            shape: {
              placeholder: { type: "TITLE" },
              text: {
                textElements: [
                  { paragraphMarker: {} },
                  { textRun: { content: "Q3 Summary\n" } }
                ]
              }
            }
          },
          {
            objectId: "shape-body",
            shape: {
              text: {
                textElements: [
                  { paragraphMarker: { bullet: {} } },
                  { textRun: { content: "Revenue up\n" } },
                  { paragraphMarker: { bullet: {} } },
                  { textRun: { content: "Costs flat\n" } }
                ]
              }
            }
          },
          {
            objectId: "table-1",
            table: {
              tableRows: [
                {
                  tableCells: [
                    {
                      text: {
                        textElements: [
                          { paragraphMarker: {} },
                          { textRun: { content: "Metric\n" } }
                        ]
                      }
                    },
                    {
                      text: {
                        textElements: [
                          { paragraphMarker: {} },
                          { textRun: { content: "Value\n" } }
                        ]
                      }
                    }
                  ]
                },
                {
                  tableCells: [
                    {
                      text: {
                        textElements: [
                          { paragraphMarker: {} },
                          { textRun: { content: "MAU\n" } }
                        ]
                      }
                    },
                    {
                      text: {
                        textElements: [
                          { paragraphMarker: {} },
                          { textRun: { content: "1.2M\n" } }
                        ]
                      }
                    }
                  ]
                }
              ]
            }
          },
          {
            objectId: "chart-1",
            sheetsChart: {
              spreadsheetId: "sheet-123",
              chartId: 88
            }
          }
        ]
      }
    ]
  });

  assert.equal(normalized.title, "Quarterly Review");
  assert.equal(normalized.revisionId, "rev-1");
  assert.equal(normalized.slideCount, 1);
  assert.match(normalized.markdown, /## Slide 1/);
  assert.match(normalized.markdown, /### Q3 Summary/);
  assert.match(normalized.markdown, /- Revenue up/);
  assert.match(normalized.markdown, /\| Metric \| Value \|/);
  assert.match(normalized.markdown, /Linked Google Sheets chart/);
  assert.equal(normalized.slides[0].title, "Q3 Summary");
});

test("buildSlideRequestsFromOperations scopes placeholder replacement and shape replacement", () => {
  const built = buildSlideRequestsFromOperations({
    operations: [
      {
        mode: "replace_all_text",
        match_text: "{{owner}}",
        replace_text: "Erik",
        slide_number: 2,
        match_case: true
      },
      {
        mode: "replace_shape_text",
        object_id: "shape-2",
        text: "Updated body"
      }
    ],
    presentationPayload: {
      slides: [
        {
          objectId: "slide-1",
          pageElements: [
            {
              objectId: "shape-1",
              shape: {
                text: {
                  textElements: [{ paragraphMarker: {} }, { textRun: { content: "A\n" } }]
                }
              }
            }
          ]
        },
        {
          objectId: "slide-2",
          pageElements: [
            {
              objectId: "shape-2",
              shape: {
                text: {
                  textElements: [{ paragraphMarker: {} }, { textRun: { content: "B\n" } }]
                }
              }
            }
          ]
        }
      ]
    }
  });

  assert.equal(built.requests.length, 3);
  assert.deepEqual(built.requests[0], {
    replaceAllText: {
      containsText: {
        text: "{{owner}}",
        matchCase: true
      },
      replaceText: "Erik",
      pageObjectIds: ["slide-2"]
    }
  });
  assert.deepEqual(built.requests[1], {
    deleteText: {
      objectId: "shape-2",
      textRange: {
        type: "ALL"
      }
    }
  });
  assert.deepEqual(built.requests[2], {
    insertText: {
      objectId: "shape-2",
      text: "Updated body",
      insertionIndex: 0
    }
  });
  assert.equal(built.operations[0].slideObjectId, "slide-2");
  assert.equal(built.operations[1].slideNumber, 2);
});

test("buildSlideRequestsFromOperations supports table cell replacement", () => {
  const built = buildSlideRequestsFromOperations({
    operations: [
      {
        mode: "replace_table_cell_text",
        object_id: "table-2",
        row_index: 1,
        column_index: 3,
        text: "7/9"
      }
    ],
    presentationPayload: {
      slides: [
        {
          objectId: "slide-16",
          pageElements: [
            {
              objectId: "table-2",
              table: {
                tableRows: [
                  {
                    tableCells: [{}, {}, {}, {}]
                  },
                  {
                    tableCells: [{}, {}, {}, {}]
                  }
                ]
              }
            }
          ]
        }
      ]
    }
  });

  assert.equal(built.requests.length, 2);
  assert.deepEqual(built.requests[0], {
    deleteText: {
      objectId: "table-2",
      cellLocation: {
        rowIndex: 1,
        columnIndex: 3
      },
      textRange: {
        type: "ALL"
      }
    }
  });
  assert.deepEqual(built.requests[1], {
    insertText: {
      objectId: "table-2",
      cellLocation: {
        rowIndex: 1,
        columnIndex: 3
      },
      text: "7/9",
      insertionIndex: 0
    }
  });
  assert.equal(built.operations[0].mode, "replace_table_cell_text");
  assert.equal(built.operations[0].objectId, "table-2");
  assert.equal(built.operations[0].rowIndex, 1);
  assert.equal(built.operations[0].columnIndex, 3);
  assert.equal(built.operations[0].text, "7/9");
  assert.equal(built.operations[0].slideNumber, 1);
  assert.equal(built.operations[0].slideObjectId, "slide-16");
  assert.equal(built.operations[0].sheetRowNumber, null);
});

test("planGoogleSlideSheetMappings converts sheet rows into slide operations", () => {
  const planned = planGoogleSlideSheetMappings({
    rows: [
      ["mode", "placeholder", "value", "slide", "object_id", "text", "enabled"],
      ["replace_all_text", "{{deadline}}", "July 6", "2", "", "", "true"],
      ["replace_shape_text", "", "", "", "shape-7", "Specific block", "true"],
      ["", "", "", "", "", "", ""],
      ["replace_all_text", "{{skip}}", "Nope", "1", "", "", "false"]
    ]
  });

  assert.equal(planned.operations.length, 2);
  assert.deepEqual(planned.operations[0], {
    mode: "replace_all_text",
    match_text: "{{deadline}}",
    replace_text: "July 6",
    slide_number: 2,
    slide_object_id: null,
    match_case: true,
    sheet_row_number: 2
  });
  assert.deepEqual(planned.operations[1], {
    mode: "replace_shape_text",
    object_id: "shape-7",
    text: "Specific block",
    sheet_row_number: 3
  });
  assert.equal(planned.summary.plannedOperations, 2);
  assert.equal(planned.summary.skippedRows.length, 2);
});
