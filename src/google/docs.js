import { getConfig } from "../config.js";
import { AppError } from "../errors.js";
import { resolveGoogleDocSource } from "../lib/googleLinks.js";
import { googleAuthProvider } from "./auth.js";

function normalizeText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u000b/g, "\n")
    .replace(/\n+$/g, "")
    .trimEnd();
}

function extractTextFromParagraph(paragraph) {
  const elements = Array.isArray(paragraph?.elements) ? paragraph.elements : [];
  return normalizeText(
    elements
      .map((element) => {
        if (element?.textRun?.content) {
          return element.textRun.content;
        }

        if (element?.autoText?.content) {
          return element.autoText.content;
        }

        return "";
      })
      .join("")
  );
}

function headingLevel(namedStyleType) {
  const match = /^HEADING_(\d+)$/.exec(namedStyleType ?? "");
  return match ? Number(match[1]) : null;
}

function renderParagraphBlock(element, context) {
  const paragraph = element?.paragraph;
  if (!paragraph) {
    return null;
  }

  const text = extractTextFromParagraph(paragraph);
  if (!text) {
    return null;
  }

  const namedStyleType = paragraph?.paragraphStyle?.namedStyleType;
  const level = headingLevel(namedStyleType);
  const isBullet = Boolean(paragraph?.bullet);

  if (level) {
    return {
      kind: "heading",
      text,
      markdown: `${"#".repeat(level)} ${text}`,
      tabId: context.tabId,
      tabTitle: context.tabTitle
    };
  }

  if (namedStyleType === "TITLE") {
    return {
      kind: "heading",
      text,
      markdown: `# ${text}`,
      tabId: context.tabId,
      tabTitle: context.tabTitle
    };
  }

  if (isBullet) {
    return {
      kind: "list_item",
      text,
      markdown: `- ${text}`,
      tabId: context.tabId,
      tabTitle: context.tabTitle
    };
  }

  return {
    kind: "paragraph",
    text,
    markdown: text,
    tabId: context.tabId,
    tabTitle: context.tabTitle
  };
}

function extractPlainTextFromStructuralElements(elements) {
  const blocks = normalizeStructuralElements(elements, {
    tabId: null,
    tabTitle: null
  });

  return blocks
    .map((block) => block.text ?? block.markdown)
    .filter(Boolean)
    .join("\n");
}

function renderTableBlock(element, context) {
  const rows = Array.isArray(element?.table?.tableRows)
    ? element.table.tableRows
    : [];

  if (rows.length === 0) {
    return null;
  }

  const renderedRows = rows.map((row) =>
    (row?.tableCells ?? []).map((cell) =>
      normalizeText(extractPlainTextFromStructuralElements(cell?.content ?? []))
    )
  );

  const [header = [], ...body] = renderedRows;
  const headerMarkdown =
    header.length > 0
      ? `| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |`
      : "";
  const bodyMarkdown = body
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");

  return {
    kind: "table",
    rows: renderedRows,
    markdown: [headerMarkdown, bodyMarkdown].filter(Boolean).join("\n"),
    text: renderedRows.map((row) => row.join("\t")).join("\n"),
    tabId: context.tabId,
    tabTitle: context.tabTitle
  };
}

function normalizeStructuralElements(elements, context) {
  const blocks = [];

  for (const element of elements ?? []) {
    if (element?.paragraph) {
      const paragraphBlock = renderParagraphBlock(element, context);
      if (paragraphBlock) {
        blocks.push(paragraphBlock);
      }
      continue;
    }

    if (element?.table) {
      const tableBlock = renderTableBlock(element, context);
      if (tableBlock) {
        blocks.push(tableBlock);
      }
    }
  }

  return blocks;
}

function collectTabs(documentPayload) {
  if (!Array.isArray(documentPayload?.tabs) || documentPayload.tabs.length === 0) {
    return [
      {
        tabId: null,
        tabTitle: null,
        bodyContent: documentPayload?.body?.content ?? []
      }
    ];
  }

  const tabs = [];

  function visit(tab) {
    const tabProperties = tab?.tabProperties ?? {};
    const documentTab = tab?.documentTab ?? {};

    tabs.push({
      tabId: tabProperties?.tabId ?? tab?.tabId ?? null,
      tabTitle: tabProperties?.title ?? tab?.title ?? null,
      bodyContent: documentTab?.body?.content ?? []
    });

    for (const child of tab?.childTabs ?? []) {
      visit(child);
    }
  }

  for (const tab of documentPayload.tabs) {
    visit(tab);
  }

  return tabs;
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, maxChars)}\n\n[truncated]`,
    truncated: true
  };
}

function isMarkdownCommentLine(line) {
  return /^<!--.*-->$/.test(line.trim());
}

function isMarkdownTableRow(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

function isMarkdownTableSeparatorRow(line) {
  const trimmed = line.trim();
  return /^(\|\s*:?-{3,}:?\s*)+\|$/.test(trimmed);
}

function splitMarkdownTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function findUnescapedSequence(text, sequence, fromIndex) {
  let searchIndex = fromIndex;

  while (searchIndex < text.length) {
    const matchIndex = text.indexOf(sequence, searchIndex);
    if (matchIndex === -1) {
      return -1;
    }

    if (matchIndex === 0 || text[matchIndex - 1] !== "\\") {
      return matchIndex;
    }

    searchIndex = matchIndex + 1;
  }

  return -1;
}

function appendInlineParseResult(target, parsed, wrapperStyle = null) {
  const offset = target.text.length;
  target.text += parsed.text;

  for (const span of parsed.spans) {
    target.spans.push({
      start: span.start + offset,
      end: span.end + offset,
      style: { ...span.style }
    });
  }

  if (wrapperStyle && parsed.text.length > 0) {
    target.spans.push({
      start: offset,
      end: offset + parsed.text.length,
      style: { ...wrapperStyle }
    });
  }
}

function parseMarkdownLinkToken(text, index) {
  if (text[index] !== "[") {
    return null;
  }

  const closingBracket = findUnescapedSequence(text, "]", index + 1);
  if (closingBracket === -1 || text[closingBracket + 1] !== "(") {
    return null;
  }

  const closingParen = findUnescapedSequence(text, ")", closingBracket + 2);
  if (closingParen === -1) {
    return null;
  }

  return {
    label: text.slice(index + 1, closingBracket),
    url: text.slice(closingBracket + 2, closingParen).trim(),
    nextIndex: closingParen + 1
  };
}

export function parseInlineMarkdown(text) {
  const source = String(text ?? "");
  const result = {
    text: "",
    spans: []
  };

  const wrappedDelimiters = [
    {
      delimiter: "***",
      style: { bold: true, italic: true }
    },
    {
      delimiter: "___",
      style: { bold: true, italic: true }
    },
    {
      delimiter: "**",
      style: { bold: true }
    },
    {
      delimiter: "__",
      style: { bold: true }
    },
    {
      delimiter: "~~",
      style: { strikethrough: true }
    },
    {
      delimiter: "*",
      style: { italic: true }
    },
    {
      delimiter: "_",
      style: { italic: true }
    }
  ];

  let index = 0;
  while (index < source.length) {
    if (source[index] === "\\" && index + 1 < source.length) {
      result.text += source[index + 1];
      index += 2;
      continue;
    }

    const linkToken = parseMarkdownLinkToken(source, index);
    if (linkToken) {
      const parsedLabel = parseInlineMarkdown(linkToken.label);
      appendInlineParseResult(result, parsedLabel, { link: linkToken.url });
      index = linkToken.nextIndex;
      continue;
    }

    if (source[index] === "`") {
      const closingBacktick = findUnescapedSequence(source, "`", index + 1);
      if (closingBacktick !== -1) {
        const codeText = source.slice(index + 1, closingBacktick);
        const offset = result.text.length;
        result.text += codeText;

        if (codeText.length > 0) {
          result.spans.push({
            start: offset,
            end: offset + codeText.length,
            style: { code: true }
          });
        }

        index = closingBacktick + 1;
        continue;
      }
    }

    let matchedWrappedDelimiter = false;
    for (const candidate of wrappedDelimiters) {
      if (!source.startsWith(candidate.delimiter, index)) {
        continue;
      }

      const closingDelimiter = findUnescapedSequence(
        source,
        candidate.delimiter,
        index + candidate.delimiter.length
      );
      if (closingDelimiter === -1) {
        continue;
      }

      const innerText = source.slice(
        index + candidate.delimiter.length,
        closingDelimiter
      );
      const parsedInner = parseInlineMarkdown(innerText);
      appendInlineParseResult(result, parsedInner, candidate.style);
      index = closingDelimiter + candidate.delimiter.length;
      matchedWrappedDelimiter = true;
      break;
    }

    if (matchedWrappedDelimiter) {
      continue;
    }

    result.text += source[index];
    index += 1;
  }

  return result;
}

function createMarkdownTextBlock(type, rawText, extra = {}) {
  const parsed = parseInlineMarkdown(rawText);
  const block = {
    type,
    text: parsed.text,
    ...extra
  };

  if (parsed.spans.length > 0) {
    block.inlineStyles = parsed.spans;
  }

  return block;
}

function createPlainTextBlock(type, text, extra = {}) {
  return {
    type,
    text,
    ...extra
  };
}

function normalizeMarkdownParagraphLines(lines) {
  if (lines.length === 0) {
    return "";
  }

  return lines.reduce((result, line, index) => {
    if (index === 0) {
      return line.text;
    }

    const previousLine = lines[index - 1];
    return `${result}${previousLine.hardBreakAfter ? "\n" : " "}${line.text}`;
  }, "");
}

export function parseMarkdownToGoogleDocBlocks(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraphLines = [];
  let quoteLines = [];
  let codeFence = null;
  let codeLines = [];

  function flushParagraph() {
    const text = normalizeMarkdownParagraphLines(paragraphLines).trim();
    paragraphLines = [];
    if (!text) {
      return;
    }

    blocks.push(createMarkdownTextBlock("paragraph", text));
  }

  function flushBlockquote() {
    const text = normalizeMarkdownParagraphLines(quoteLines).trim();
    quoteLines = [];
    if (!text) {
      return;
    }

    blocks.push(
      createMarkdownTextBlock("blockquote", text, {
        wholeTextStyle: {
          italic: true
        }
      })
    );
  }

  function flushCodeBlock() {
    const text = codeLines.join("\n");
    codeLines = [];
    if (!text) {
      return;
    }

    blocks.push(
      createPlainTextBlock("code_block", text, {
        wholeTextStyle: {
          code: true
        }
      })
    );
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const rawLineWithoutTrailingSpaces = rawLine.replace(/\s+$/g, "");
    const trimmedLine = rawLine.trim();

    if (codeFence) {
      if (trimmedLine.startsWith(codeFence)) {
        flushCodeBlock();
        codeFence = null;
      } else {
        codeLines.push(rawLineWithoutTrailingSpaces);
      }
      continue;
    }

    const codeFenceMatch = /^(```+|~~~+)/.exec(trimmedLine);
    if (codeFenceMatch) {
      flushParagraph();
      flushBlockquote();
      codeFence = codeFenceMatch[1];
      codeLines = [];
      continue;
    }

    if (!trimmedLine) {
      flushParagraph();
      flushBlockquote();
      continue;
    }

    if (isMarkdownCommentLine(rawLine)) {
      continue;
    }

    const blockquoteMatch = /^>\s?(.*)$/.exec(rawLineWithoutTrailingSpaces);
    if (blockquoteMatch) {
      flushParagraph();
      quoteLines.push({
        text: blockquoteMatch[1].trim(),
        hardBreakAfter: false
      });
      continue;
    }

    flushBlockquote();

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmedLine);
    if (headingMatch) {
      flushParagraph();
      const text = headingMatch[2].trim();
      if (text) {
        blocks.push(
          createMarkdownTextBlock("heading", text, {
            level: headingMatch[1].length
          })
        );
      }
      continue;
    }

    const bulletMatch = /^[-*]\s+(.*)$/.exec(trimmedLine);
    if (bulletMatch) {
      flushParagraph();
      const text = bulletMatch[1].trim();
      if (text) {
        blocks.push(createMarkdownTextBlock("bullet", text));
      }
      continue;
    }

    const orderedListMatch = /^(\d+)[.)]\s+(.*)$/.exec(trimmedLine);
    if (orderedListMatch) {
      flushParagraph();
      const text = orderedListMatch[2].trim();
      if (text) {
        blocks.push(createMarkdownTextBlock("ordered_list_item", text));
      }
      continue;
    }

    if (isMarkdownTableRow(rawLine)) {
      flushParagraph();
      const tableLines = [rawLine];

      while (
        index + 1 < lines.length &&
        isMarkdownTableRow(lines[index + 1].trim())
      ) {
        index += 1;
        tableLines.push(lines[index]);
      }

      for (const tableLine of tableLines) {
        if (isMarkdownTableSeparatorRow(tableLine)) {
          continue;
        }

        const cells = splitMarkdownTableRow(tableLine);
        if (cells.length > 0) {
          blocks.push(createMarkdownTextBlock("paragraph", cells.join("\t")));
        }
      }
      continue;
    }

    paragraphLines.push({
      text: rawLineWithoutTrailingSpaces.replace(/\\$/, "").trim(),
      hardBreakAfter: /\\$/.test(rawLineWithoutTrailingSpaces) || / {2,}$/.test(rawLine)
    });
  }

  if (codeFence) {
    flushCodeBlock();
  }

  flushParagraph();
  flushBlockquote();
  return blocks;
}

function getGoogleDocBodyEndIndex(documentPayload) {
  const bodyContent = documentPayload?.body?.content ?? [];
  const lastElement = bodyContent[bodyContent.length - 1];
  return Number(lastElement?.endIndex ?? 1);
}

function buildGoogleDocTextStyleRequest({ startIndex, endIndex, style }) {
  const textStyle = {};
  const fields = [];

  if (style.bold) {
    textStyle.bold = true;
    fields.push("bold");
  }

  if (style.italic) {
    textStyle.italic = true;
    fields.push("italic");
  }

  if (style.strikethrough) {
    textStyle.strikethrough = true;
    fields.push("strikethrough");
  }

  if (style.link) {
    textStyle.link = {
      url: style.link
    };
    fields.push("link");
  }

  if (style.code) {
    textStyle.weightedFontFamily = {
      fontFamily: "Courier New"
    };
    textStyle.backgroundColor = {
      color: {
        rgbColor: {
          red: 0.96,
          green: 0.96,
          blue: 0.96
        }
      }
    };
    fields.push("weightedFontFamily", "backgroundColor");
  }

  if (fields.length === 0 || endIndex <= startIndex) {
    return null;
  }

  return {
    updateTextStyle: {
      range: {
        startIndex,
        endIndex
      },
      textStyle,
      fields: fields.join(",")
    }
  };
}

export function buildGoogleDocWriteRequests({ documentPayload, markdown }) {
  const blocks = parseMarkdownToGoogleDocBlocks(markdown);
  const requests = [];
  const bodyEndIndex = getGoogleDocBodyEndIndex(documentPayload);
  const deleteEndIndex = Math.max(1, bodyEndIndex - 1);

  if (deleteEndIndex > 1) {
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: 1,
          endIndex: deleteEndIndex
        }
      }
    });
  }

  const text = blocks.length > 0 ? blocks.map((block) => `${block.text}\n`).join("") : "\n";
  requests.push({
    insertText: {
      location: {
        index: 1
      },
      text
    }
  });

  let startIndex = 1;
  for (const block of blocks) {
    const endIndex = startIndex + block.text.length + 1;

    if (block.type === "heading") {
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex,
            endIndex
          },
          paragraphStyle: {
            namedStyleType: `HEADING_${Math.min(block.level, 6)}`
          },
          fields: "namedStyleType"
        }
      });
    }

    if (block.type === "bullet") {
      requests.push({
        createParagraphBullets: {
          range: {
            startIndex,
            endIndex
          },
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE"
        }
      });
    }

    if (block.type === "ordered_list_item") {
      requests.push({
        createParagraphBullets: {
          range: {
            startIndex,
            endIndex
          },
          bulletPreset: "NUMBERED_DECIMAL_ALPHA_ROMAN"
        }
      });
    }

    if (block.wholeTextStyle) {
      const request = buildGoogleDocTextStyleRequest({
        startIndex,
        endIndex: startIndex + block.text.length,
        style: block.wholeTextStyle
      });
      if (request) {
        requests.push(request);
      }
    }

    for (const span of block.inlineStyles ?? []) {
      const request = buildGoogleDocTextStyleRequest({
        startIndex: startIndex + span.start,
        endIndex: startIndex + span.end,
        style: span.style
      });
      if (request) {
        requests.push(request);
      }
    }

    startIndex = endIndex;
  }

  return {
    requests,
    blocks,
    characterCount: text.length
  };
}

export function normalizeGoogleDocPayload(documentPayload) {
  const config = getConfig();
  const tabs = collectTabs(documentPayload);

  const normalizedTabs = tabs.map((tab, index) => {
    const blocks = normalizeStructuralElements(tab.bodyContent, {
      tabId: tab.tabId,
      tabTitle: tab.tabTitle
    });
    const markdown = blocks
      .map((block) => block.markdown)
      .filter(Boolean)
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n");
    const plainText = blocks
      .map((block) => block.text ?? block.markdown)
      .filter(Boolean)
      .join("\n");

    return {
      tabId: tab.tabId,
      tabTitle: tab.tabTitle ?? `Tab ${index + 1}`,
      markdown,
      plainText,
      blocks
    };
  });

  const multiTab = normalizedTabs.length > 1;
  const markdown = normalizedTabs
    .map((tab) => {
      if (!multiTab) {
        return tab.markdown;
      }

      return `## ${tab.tabTitle}\n\n${tab.markdown}`.trim();
    })
    .filter(Boolean)
    .join("\n\n");

  const plainText = normalizedTabs
    .map((tab) => tab.plainText)
    .filter(Boolean)
    .join("\n\n");

  const truncatedMarkdown = truncateText(markdown, config.limits.maxDocChars);
  const truncatedPlainText = truncateText(plainText, config.limits.maxDocChars);

  return {
    title: documentPayload?.title ?? "Untitled Google Doc",
    markdown: truncatedMarkdown.text,
    plainText: truncatedPlainText.text,
    tabs: normalizedTabs,
    truncated: truncatedMarkdown.truncated || truncatedPlainText.truncated
  };
}

async function fetchGoogleDocDocument(documentId, accessToken) {
  const url = new URL(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`
  );
  url.searchParams.set("includeTabsContent", "true");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 404) {
    throw new AppError("NOT_FOUND", "Google Doc not found.", {
      details: { documentId }
    });
  }

  if (response.status === 403) {
    throw new AppError(
      "PERMISSION_DENIED",
      "Google Docs API denied access to this document.",
      { details: { documentId } }
    );
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new AppError("UPSTREAM_ERROR", "Google Docs API request failed.", {
      retryable: response.status >= 500,
      details: { status: response.status, responseText }
    });
  }

  return response.json();
}

async function batchUpdateGoogleDoc({ documentId, requests, accessToken }) {
  const response = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(
      documentId
    )}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requests
      })
    }
  );

  if (response.status === 404) {
    throw new AppError("NOT_FOUND", "Google Doc not found.", {
      details: { documentId }
    });
  }

  if (response.status === 403) {
    throw new AppError(
      "PERMISSION_DENIED",
      "Google Docs API denied write access to this document.",
      { details: { documentId } }
    );
  }

  if (response.status === 400) {
    const responseText = await response.text();
    throw new AppError(
      "INVALID_SOURCE",
      "Google Docs API rejected the document write request.",
      {
        details: { status: response.status, responseText }
      }
    );
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new AppError("UPSTREAM_ERROR", "Google Docs API batch update failed.", {
      retryable: response.status >= 500,
      details: { status: response.status, responseText }
    });
  }

  return response.json();
}

export async function readGoogleDoc(source) {
  const { documentId, sourceUrl } = resolveGoogleDocSource(source);
  const accessToken = await googleAuthProvider.getAccessToken();
  const payload = await fetchGoogleDocDocument(documentId, accessToken);
  const normalized = normalizeGoogleDocPayload(payload);

  return {
    sourceId: documentId,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    ...normalized
  };
}

export async function writeGoogleDoc({ source, markdown, dryRun = false }) {
  const { documentId, sourceUrl } = resolveGoogleDocSource(source);
  const accessToken = await googleAuthProvider.getAccessToken();
  const documentPayload = await fetchGoogleDocDocument(documentId, accessToken);

  if (Array.isArray(documentPayload?.tabs) && documentPayload.tabs.length > 1) {
    throw new AppError(
      "INVALID_SOURCE",
      "Google Doc write currently supports single-tab documents only."
    );
  }

  const plan = buildGoogleDocWriteRequests({
    documentPayload,
    markdown
  });

  if (!dryRun) {
    await batchUpdateGoogleDoc({
      documentId,
      requests: plan.requests,
      accessToken
    });
  }

  return {
    sourceId: documentId,
    sourceUrl,
    title: documentPayload?.title ?? "Untitled Google Doc",
    requestCount: plan.requests.length,
    blockCount: plan.blocks.length,
    characterCount: plan.characterCount,
    dryRun: Boolean(dryRun),
    fetchedAt: new Date().toISOString()
  };
}
