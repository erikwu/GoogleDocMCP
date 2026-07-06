import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGoogleDocWriteRequests,
  parseMarkdownToGoogleDocBlocks
} from "../src/google/docs.js";

test("parseMarkdownToGoogleDocBlocks keeps headings, bullets, and table rows readable", () => {
  const blocks = parseMarkdownToGoogleDocBlocks(`
# Release Note

Intro paragraph line one.
line two.

- First bullet
- Second bullet

| Name | Value |
| --- | --- |
| A | 1 |
| B | 2 |
`);

  assert.deepEqual(blocks, [
    { type: "heading", level: 1, text: "Release Note" },
    { type: "paragraph", text: "Intro paragraph line one. line two." },
    { type: "bullet", text: "First bullet" },
    { type: "bullet", text: "Second bullet" },
    { type: "paragraph", text: "Name\tValue" },
    { type: "paragraph", text: "A\t1" },
    { type: "paragraph", text: "B\t2" }
  ]);
});

test("parseMarkdownToGoogleDocBlocks preserves common markdown formatting intent", () => {
  const blocks = parseMarkdownToGoogleDocBlocks(`
# **Release** Note

1. First **ordered** item
2. Second item with [link](https://example.com)

> Quoted *text*

\`\`\`
const value = 42;
\`\`\`
`);

  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[0].text, "Release Note");
  assert.deepEqual(blocks[0].inlineStyles, [
    {
      start: 0,
      end: 7,
      style: { bold: true }
    }
  ]);

  assert.equal(blocks[1].type, "ordered_list_item");
  assert.equal(blocks[1].text, "First ordered item");
  assert.deepEqual(blocks[1].inlineStyles, [
    {
      start: 6,
      end: 13,
      style: { bold: true }
    }
  ]);

  assert.equal(blocks[2].type, "ordered_list_item");
  assert.equal(blocks[2].text, "Second item with link");
  assert.deepEqual(blocks[2].inlineStyles, [
    {
      start: 17,
      end: 21,
      style: { link: "https://example.com" }
    }
  ]);

  assert.equal(blocks[3].type, "blockquote");
  assert.equal(blocks[3].text, "Quoted text");
  assert.deepEqual(blocks[3].wholeTextStyle, { italic: true });
  assert.deepEqual(blocks[3].inlineStyles, [
    {
      start: 7,
      end: 11,
      style: { italic: true }
    }
  ]);

  assert.equal(blocks[4].type, "code_block");
  assert.equal(blocks[4].text, "const value = 42;");
  assert.deepEqual(blocks[4].wholeTextStyle, { code: true });
});

test("buildGoogleDocWriteRequests creates overwrite requests with styles and bullets", () => {
  const plan = buildGoogleDocWriteRequests({
    documentPayload: {
      body: {
        content: [
          { startIndex: 0, endIndex: 1 },
          { startIndex: 1, endIndex: 12 }
        ]
      }
    },
    markdown: `# Title

Paragraph body.

- Bullet item`
  });

  assert.deepEqual(plan.requests[0], {
    deleteContentRange: {
      range: {
        startIndex: 1,
        endIndex: 11
      }
    }
  });
  assert.deepEqual(plan.requests[1], {
    insertText: {
      location: {
        index: 1
      },
      text: "Title\nParagraph body.\nBullet item\n"
    }
  });
  assert.deepEqual(plan.requests[2], {
    updateParagraphStyle: {
      range: {
        startIndex: 1,
        endIndex: 7
      },
      paragraphStyle: {
        namedStyleType: "HEADING_1"
      },
      fields: "namedStyleType"
    }
  });
  assert.deepEqual(plan.requests[3], {
    createParagraphBullets: {
      range: {
        startIndex: 23,
        endIndex: 35
      },
      bulletPreset: "BULLET_DISC_CIRCLE_SQUARE"
    }
  });
  assert.equal(plan.blocks.length, 3);
});

test("buildGoogleDocWriteRequests adds inline styles, ordered lists, and code block styling", () => {
  const plan = buildGoogleDocWriteRequests({
    documentPayload: {
      body: {
        content: [
          { startIndex: 0, endIndex: 1 },
          { startIndex: 1, endIndex: 20 }
        ]
      }
    },
    markdown: `# **Release** Note

1. First **ordered** item

\`\`\`
const value = 42;
\`\`\``
  });

  assert.deepEqual(plan.requests[1], {
    insertText: {
      location: {
        index: 1
      },
      text: "Release Note\nFirst ordered item\nconst value = 42;\n"
    }
  });

  assert.deepEqual(plan.requests[2], {
    updateParagraphStyle: {
      range: {
        startIndex: 1,
        endIndex: 14
      },
      paragraphStyle: {
        namedStyleType: "HEADING_1"
      },
      fields: "namedStyleType"
    }
  });

  assert.deepEqual(plan.requests[3], {
    updateTextStyle: {
      range: {
        startIndex: 1,
        endIndex: 8
      },
      textStyle: {
        bold: true
      },
      fields: "bold"
    }
  });

  assert.deepEqual(plan.requests[4], {
    createParagraphBullets: {
      range: {
        startIndex: 14,
        endIndex: 33
      },
      bulletPreset: "NUMBERED_DECIMAL_ALPHA_ROMAN"
    }
  });

  assert.deepEqual(plan.requests[5], {
    updateTextStyle: {
      range: {
        startIndex: 20,
        endIndex: 27
      },
      textStyle: {
        bold: true
      },
      fields: "bold"
    }
  });

  assert.deepEqual(plan.requests[6], {
    updateTextStyle: {
      range: {
        startIndex: 33,
        endIndex: 50
      },
      textStyle: {
        weightedFontFamily: {
          fontFamily: "Courier New"
        },
        backgroundColor: {
          color: {
            rgbColor: {
              red: 0.96,
              green: 0.96,
              blue: 0.96
            }
          }
        }
      },
      fields: "weightedFontFamily,backgroundColor"
    }
  });
});
