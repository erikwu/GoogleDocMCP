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

export async function readGoogleDoc(source) {
  const { documentId, sourceUrl } = resolveGoogleDocSource(source);
  const accessToken = await googleAuthProvider.getAccessToken();
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

  const payload = await response.json();
  const normalized = normalizeGoogleDocPayload(payload);

  return {
    sourceId: documentId,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    ...normalized
  };
}
