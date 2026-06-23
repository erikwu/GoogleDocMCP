import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGoogleDocPayload } from "../src/google/docs.js";

test("normalizeGoogleDocPayload renders headings, paragraphs, and tables", () => {
  const normalized = normalizeGoogleDocPayload({
    title: "SSOT Doc",
    body: {
      content: [
        {
          paragraph: {
            paragraphStyle: { namedStyleType: "HEADING_1" },
            elements: [{ textRun: { content: "Overview\n" } }]
          }
        },
        {
          paragraph: {
            elements: [{ textRun: { content: "Line one.\n" } }]
          }
        },
        {
          table: {
            tableRows: [
              {
                tableCells: [
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [{ textRun: { content: "Col A\n" } }]
                        }
                      }
                    ]
                  },
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [{ textRun: { content: "Col B\n" } }]
                        }
                      }
                    ]
                  }
                ]
              },
              {
                tableCells: [
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [{ textRun: { content: "1\n" } }]
                        }
                      }
                    ]
                  },
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [{ textRun: { content: "2\n" } }]
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        }
      ]
    }
  });

  assert.equal(normalized.title, "SSOT Doc");
  assert.match(normalized.markdown, /^# Overview/m);
  assert.match(normalized.markdown, /Line one\./);
  assert.match(normalized.markdown, /\| Col A \| Col B \|/);
});
