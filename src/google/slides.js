import { getConfig } from "../config.js";
import { AppError } from "../errors.js";
import { resolveGoogleSlideSource } from "../lib/googleLinks.js";
import { readGoogleSheet } from "./sheets.js";
import { googleAuthProvider } from "./auth.js";

const TITLE_PLACEHOLDER_TYPES = new Set([
  "TITLE",
  "CENTERED_TITLE",
  "SECTION_HEADER"
]);
const SUBTITLE_PLACEHOLDER_TYPES = new Set(["SUBTITLE"]);
const FALSE_VALUES = new Set(["0", "false", "no", "n", "off", "disabled"]);
const TRUE_VALUES = new Set(["1", "true", "yes", "y", "on", "enabled"]);

const COLUMN_ALIASES = {
  mode: ["mode", "action", "operation"],
  placeholder: ["placeholder", "match_text", "find_text", "token", "key"],
  value: ["value", "replace_text", "replacement", "replace_with"],
  slide: [
    "slide",
    "slide_number",
    "slide_id",
    "slide_object_id",
    "page_id",
    "page_object_id"
  ],
  objectId: ["object_id", "shape_id", "element_id"],
  text: ["text", "shape_text", "content"],
  enabled: ["enabled", "apply", "active"],
  matchCase: ["match_case", "case_sensitive"]
};

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeText(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u000b/g, "\n")
    .replace(/\n+$/g, "")
    .trimEnd();
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

function normalizeHeaderKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeBooleanish(value, defaultValue) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return defaultValue;
}

function getShapePlaceholderType(pageElement) {
  return (
    pageElement?.shape?.placeholder?.type ??
    pageElement?.shape?.shapeProperties?.placeholder?.type ??
    null
  );
}

function detectPageElementKind(pageElement) {
  if (pageElement?.shape) {
    return "shape";
  }

  if (pageElement?.table) {
    return "table";
  }

  if (pageElement?.sheetsChart) {
    return "sheetsChart";
  }

  if (pageElement?.wordArt) {
    return "wordArt";
  }

  if (pageElement?.image) {
    return "image";
  }

  if (pageElement?.video) {
    return "video";
  }

  if (pageElement?.line) {
    return "line";
  }

  if (pageElement?.group) {
    return "group";
  }

  return "unknown";
}

function extractParagraphsFromTextElements(textElements) {
  const paragraphs = [];
  let current = null;

  function beginParagraph(paragraphMarker) {
    current = {
      text: "",
      bullet: Boolean(paragraphMarker?.bullet)
    };
  }

  function ensureParagraph() {
    if (!current) {
      beginParagraph(null);
    }
  }

  function flushParagraph() {
    if (!current) {
      return;
    }

    const text = normalizeText(current.text);
    if (text) {
      paragraphs.push({
        text,
        bullet: current.bullet
      });
    }

    current = null;
  }

  for (const element of textElements ?? []) {
    if (element?.paragraphMarker) {
      flushParagraph();
      beginParagraph(element.paragraphMarker);
      continue;
    }

    if (element?.textRun?.content) {
      ensureParagraph();
      current.text += element.textRun.content;
      continue;
    }

    if (element?.autoText?.content) {
      ensureParagraph();
      current.text += element.autoText.content;
    }
  }

  flushParagraph();
  return paragraphs;
}

function renderSlideParagraphMarkdown(paragraph, context, paragraphIndex) {
  if (
    TITLE_PLACEHOLDER_TYPES.has(context.placeholderType) &&
    paragraphIndex === 0
  ) {
    return `### ${paragraph.text}`;
  }

  if (
    SUBTITLE_PLACEHOLDER_TYPES.has(context.placeholderType) &&
    paragraphIndex === 0
  ) {
    return `_${paragraph.text}_`;
  }

  if (paragraph.bullet) {
    return `- ${paragraph.text}`;
  }

  return paragraph.text;
}

function extractCellText(tableCell) {
  const paragraphs = extractParagraphsFromTextElements(
    tableCell?.text?.textElements ?? []
  );

  return normalizeText(paragraphs.map((paragraph) => paragraph.text).join("\n"));
}

function normalizeShapeElement(pageElement) {
  const placeholderType = getShapePlaceholderType(pageElement);
  const paragraphs = extractParagraphsFromTextElements(
    pageElement?.shape?.text?.textElements ?? []
  );
  const markdown = paragraphs
    .map((paragraph, index) =>
      renderSlideParagraphMarkdown(paragraph, { placeholderType }, index)
    )
    .join("\n\n");
  const text = normalizeText(paragraphs.map((paragraph) => paragraph.text).join("\n"));

  return {
    objectId: pageElement?.objectId ?? null,
    kind: "shape",
    title: pageElement?.title ?? null,
    description: pageElement?.description ?? null,
    shapeType: pageElement?.shape?.shapeType ?? null,
    placeholderType,
    text,
    markdown,
    paragraphs
  };
}

function normalizeTableElement(pageElement) {
  const rows = Array.isArray(pageElement?.table?.tableRows)
    ? pageElement.table.tableRows.map((row) =>
        (row?.tableCells ?? []).map((cell) => extractCellText(cell))
      )
    : [];

  const [header = [], ...body] = rows;
  const headerMarkdown =
    header.length > 0
      ? `| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |`
      : "";
  const bodyMarkdown = body
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
  const markdown = [headerMarkdown, bodyMarkdown].filter(Boolean).join("\n");

  return {
    objectId: pageElement?.objectId ?? null,
    kind: "table",
    title: pageElement?.title ?? null,
    description: pageElement?.description ?? null,
    rows,
    text: rows.map((row) => row.join("\t")).join("\n"),
    markdown
  };
}

function normalizeWordArtElement(pageElement) {
  const text = normalizeText(pageElement?.wordArt?.renderedText ?? "");

  return {
    objectId: pageElement?.objectId ?? null,
    kind: "wordArt",
    title: pageElement?.title ?? null,
    description: pageElement?.description ?? null,
    text,
    markdown: text
  };
}

function normalizeSheetsChartElement(pageElement) {
  const spreadsheetId = pageElement?.sheetsChart?.spreadsheetId ?? null;
  const chartId = pageElement?.sheetsChart?.chartId ?? null;
  const text = normalizeText(
    [
      "Linked Google Sheets chart",
      spreadsheetId ? `(spreadsheet: ${spreadsheetId})` : "",
      chartId ? `(chart: ${chartId})` : ""
    ]
      .filter(Boolean)
      .join(" ")
  );

  return {
    objectId: pageElement?.objectId ?? null,
    kind: "sheetsChart",
    title: pageElement?.title ?? null,
    description: pageElement?.description ?? null,
    spreadsheetId,
    chartId,
    text,
    markdown: text ? `> ${text}` : ""
  };
}

function normalizeImageElement(pageElement) {
  const parts = [pageElement?.title, pageElement?.description].filter(Boolean);
  const text = normalizeText(parts.join(" - "));

  return {
    objectId: pageElement?.objectId ?? null,
    kind: "image",
    title: pageElement?.title ?? null,
    description: pageElement?.description ?? null,
    text,
    markdown: ""
  };
}

function normalizeVideoElement(pageElement) {
  const text = normalizeText(pageElement?.video?.id ?? "");

  return {
    objectId: pageElement?.objectId ?? null,
    kind: "video",
    title: pageElement?.title ?? null,
    description: pageElement?.description ?? null,
    text,
    markdown: ""
  };
}

function normalizeGenericElement(pageElement) {
  return {
    objectId: pageElement?.objectId ?? null,
    kind: detectPageElementKind(pageElement),
    title: pageElement?.title ?? null,
    description: pageElement?.description ?? null,
    text: "",
    markdown: ""
  };
}

function normalizePageElement(pageElement) {
  const kind = detectPageElementKind(pageElement);

  if (kind === "shape") {
    return normalizeShapeElement(pageElement);
  }

  if (kind === "table") {
    return normalizeTableElement(pageElement);
  }

  if (kind === "wordArt") {
    return normalizeWordArtElement(pageElement);
  }

  if (kind === "sheetsChart") {
    return normalizeSheetsChartElement(pageElement);
  }

  if (kind === "image") {
    return normalizeImageElement(pageElement);
  }

  if (kind === "video") {
    return normalizeVideoElement(pageElement);
  }

  return normalizeGenericElement(pageElement);
}

function resolveSlideTitle(pageElements) {
  const explicitTitle = pageElements.find(
    (element) =>
      element.kind === "shape" &&
      TITLE_PLACEHOLDER_TYPES.has(element.placeholderType) &&
      element.text
  );

  if (explicitTitle) {
    return explicitTitle.text.split("\n")[0];
  }

  const firstTextElement = pageElements.find((element) => element.text);
  return firstTextElement ? firstTextElement.text.split("\n")[0] : null;
}

function normalizeSlidePayload(slide, slideIndex) {
  const pageElements = Array.isArray(slide?.pageElements)
    ? slide.pageElements.map((pageElement) => normalizePageElement(pageElement))
    : [];
  const title = resolveSlideTitle(pageElements);
  const markdownBlocks = pageElements
    .map((element) => element.markdown)
    .filter(Boolean);
  const plainText = pageElements
    .map((element) => element.text)
    .filter(Boolean)
    .join("\n\n");

  return {
    slideNumber: slideIndex + 1,
    objectId: slide?.objectId ?? null,
    layoutObjectId: slide?.slideProperties?.layoutObjectId ?? null,
    title,
    markdown: [`## Slide ${slideIndex + 1}`, ...markdownBlocks].join("\n\n"),
    plainText,
    pageElements
  };
}

export function normalizeGoogleSlidePayload(presentationPayload) {
  const config = getConfig();
  const slides = Array.isArray(presentationPayload?.slides)
    ? presentationPayload.slides.map((slide, index) =>
        normalizeSlidePayload(slide, index)
      )
    : [];
  const markdown = slides.map((slide) => slide.markdown).join("\n\n");
  const plainText = slides
    .map((slide) => {
      const prefix = slide.title
        ? `Slide ${slide.slideNumber}: ${slide.title}`
        : `Slide ${slide.slideNumber}`;
      return [prefix, slide.plainText].filter(Boolean).join("\n");
    })
    .join("\n\n");
  const truncatedMarkdown = truncateText(markdown, config.limits.maxDocChars);
  const truncatedPlainText = truncateText(plainText, config.limits.maxDocChars);

  return {
    title: presentationPayload?.title ?? "Untitled Google Slide Deck",
    revisionId: presentationPayload?.revisionId ?? null,
    slideCount: slides.length,
    markdown: truncatedMarkdown.text,
    plainText: truncatedPlainText.text,
    slides,
    truncated: truncatedMarkdown.truncated || truncatedPlainText.truncated
  };
}

async function fetchGoogleSlidePresentation(presentationId, accessToken) {
  const url = new URL(
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(
      presentationId
    )}`
  );

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 404) {
    throw new AppError("NOT_FOUND", "Google Slide presentation not found.", {
      details: { presentationId }
    });
  }

  if (response.status === 403) {
    throw new AppError(
      "PERMISSION_DENIED",
      "Google Slides API denied access to this presentation.",
      {
        details: { presentationId }
      }
    );
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new AppError(
      "UPSTREAM_ERROR",
      "Google Slides API presentation request failed.",
      {
        retryable: response.status >= 500,
        details: { status: response.status, responseText }
      }
    );
  }

  return response.json();
}

function buildPresentationIndex(presentationPayload) {
  const slides = Array.isArray(presentationPayload?.slides)
    ? presentationPayload.slides
    : [];
  const slideByNumber = new Map();
  const slideByObjectId = new Map();
  const pageElementByObjectId = new Map();

  slides.forEach((slide, index) => {
    const slideInfo = {
      slideNumber: index + 1,
      slideObjectId: slide?.objectId ?? null
    };

    slideByNumber.set(index + 1, slideInfo);
    if (slideInfo.slideObjectId) {
      slideByObjectId.set(slideInfo.slideObjectId, slideInfo);
    }

    for (const pageElement of slide?.pageElements ?? []) {
      if (!pageElement?.objectId) {
        continue;
      }

      pageElementByObjectId.set(pageElement.objectId, {
        objectId: pageElement.objectId,
        kind: detectPageElementKind(pageElement),
        slideNumber: index + 1,
        slideObjectId: slide?.objectId ?? null,
        ...(pageElement?.table
          ? {
              rowCount: Array.isArray(pageElement.table.tableRows)
                ? pageElement.table.tableRows.length
                : 0,
              columnCounts: Array.isArray(pageElement.table.tableRows)
                ? pageElement.table.tableRows.map((row) =>
                    Array.isArray(row?.tableCells) ? row.tableCells.length : 0
                  )
                : []
            }
          : {})
      });
    }
  });

  return {
    slideByNumber,
    slideByObjectId,
    pageElementByObjectId
  };
}

function getRequiredString(value, fieldName, operationIndex) {
  if (typeof value === "string") {
    return value;
  }

  throw new AppError(
    "INVALID_SOURCE",
    `Operation ${operationIndex + 1} is missing ${fieldName}.`
  );
}

function getOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return String(value);
}

function getRequiredInteger(value, fieldName, operationIndex, { min = null } = {}) {
  const numericValue = Number(value);
  if (
    !Number.isInteger(numericValue) ||
    (min !== null && numericValue < min)
  ) {
    throw new AppError(
      "INVALID_SOURCE",
      `Operation ${operationIndex + 1} must provide ${fieldName} as an integer${
        min !== null ? ` >= ${min}` : ""
      }.`
    );
  }

  return numericValue;
}

function normalizeSlideWriteOperations(operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new AppError(
      "INVALID_SOURCE",
      "Provide at least one Google Slide write operation."
    );
  }

  return operations.map((operation, index) => {
    const mode = getRequiredString(operation?.mode, "mode", index);
    const sheetRowNumber =
      operation?.sheet_row_number === undefined ||
      operation?.sheet_row_number === null
        ? null
        : Number(operation.sheet_row_number);

    if (mode === "replace_all_text") {
      if (!hasOwn(operation, "replace_text")) {
        throw new AppError(
          "INVALID_SOURCE",
          `Operation ${index + 1} must provide replace_text.`
        );
      }

      return {
        mode,
        matchText: getRequiredString(operation?.match_text, "match_text", index),
        replaceText: String(operation?.replace_text ?? ""),
        slideNumber:
          operation?.slide_number === undefined || operation?.slide_number === null
            ? null
            : Number(operation.slide_number),
        slideObjectId: getOptionalString(operation?.slide_object_id),
        matchCase:
          operation?.match_case === undefined
            ? true
            : Boolean(operation.match_case),
        sheetRowNumber
      };
    }

    if (mode === "replace_shape_text") {
      if (!hasOwn(operation, "text") && !hasOwn(operation, "replace_text")) {
        throw new AppError(
          "INVALID_SOURCE",
          `Operation ${index + 1} must provide text.`
        );
      }

      return {
        mode,
        objectId: getRequiredString(operation?.object_id, "object_id", index),
        text: String(operation?.text ?? operation?.replace_text ?? ""),
        sheetRowNumber
      };
    }

    if (mode === "replace_table_cell_text") {
      if (!hasOwn(operation, "text") && !hasOwn(operation, "replace_text")) {
        throw new AppError(
          "INVALID_SOURCE",
          `Operation ${index + 1} must provide text.`
        );
      }

      return {
        mode,
        objectId: getRequiredString(operation?.object_id, "object_id", index),
        rowIndex: getRequiredInteger(
          operation?.row_index,
          "row_index",
          index,
          { min: 0 }
        ),
        columnIndex: getRequiredInteger(
          operation?.column_index,
          "column_index",
          index,
          { min: 0 }
        ),
        text: String(operation?.text ?? operation?.replace_text ?? ""),
        sheetRowNumber
      };
    }

    throw new AppError(
      "INVALID_SOURCE",
      `Unsupported Google Slide operation mode: ${mode}.`
    );
  });
}

function resolveScopedSlideObjectId(operation, presentationIndex) {
  if (operation.slideNumber !== null && !Number.isInteger(operation.slideNumber)) {
    throw new AppError(
      "INVALID_SOURCE",
      "slide_number must be a positive integer."
    );
  }

  let fromNumber = null;
  if (operation.slideNumber !== null) {
    fromNumber = presentationIndex.slideByNumber.get(operation.slideNumber);
    if (!fromNumber) {
      throw new AppError(
        "NOT_FOUND",
        `Slide ${operation.slideNumber} was not found in this presentation.`
      );
    }
  }

  let fromObjectId = null;
  if (operation.slideObjectId) {
    fromObjectId = presentationIndex.slideByObjectId.get(operation.slideObjectId);
    if (!fromObjectId) {
      throw new AppError("NOT_FOUND", "slide_object_id was not found.", {
        details: { slideObjectId: operation.slideObjectId }
      });
    }
  }

  if (
    fromNumber &&
    fromObjectId &&
    fromNumber.slideObjectId !== fromObjectId.slideObjectId
  ) {
    throw new AppError(
      "INVALID_SOURCE",
      "slide_number and slide_object_id do not point to the same slide."
    );
  }

  return fromNumber?.slideObjectId ?? fromObjectId?.slideObjectId ?? null;
}

export function buildSlideRequestsFromOperations({
  operations,
  presentationPayload
}) {
  const normalizedOperations = normalizeSlideWriteOperations(operations);
  const presentationIndex = buildPresentationIndex(presentationPayload);
  const requests = [];
  const resolvedOperations = [];

  normalizedOperations.forEach((operation) => {
    const requestStartIndex = requests.length;

    if (operation.mode === "replace_all_text") {
      const scopedSlideObjectId = resolveScopedSlideObjectId(
        operation,
        presentationIndex
      );

      requests.push({
        replaceAllText: {
          containsText: {
            text: operation.matchText,
            matchCase: operation.matchCase
          },
          replaceText: operation.replaceText,
          ...(scopedSlideObjectId
            ? {
                pageObjectIds: [scopedSlideObjectId]
              }
            : {})
        }
      });

      resolvedOperations.push({
        mode: operation.mode,
        matchText: operation.matchText,
        replaceText: operation.replaceText,
        slideNumber: operation.slideNumber,
        slideObjectId: scopedSlideObjectId ?? operation.slideObjectId ?? null,
        matchCase: operation.matchCase,
        sheetRowNumber: operation.sheetRowNumber,
        requestStartIndex,
        requestCount: 1
      });
      return;
    }

    const pageElementInfo = presentationIndex.pageElementByObjectId.get(
      operation.objectId
    );
    if (!pageElementInfo) {
      throw new AppError("NOT_FOUND", "Google Slide object_id was not found.", {
        details: {
          objectId: operation.objectId
        }
      });
    }

    if (operation.mode === "replace_shape_text" && pageElementInfo.kind !== "shape") {
      throw new AppError(
        "INVALID_SOURCE",
        "replace_shape_text currently supports shape elements only.",
        {
          details: {
            objectId: operation.objectId,
            kind: pageElementInfo.kind
          }
        }
      );
    }

    if (
      operation.mode === "replace_table_cell_text" &&
      pageElementInfo.kind !== "table"
    ) {
      throw new AppError(
        "INVALID_SOURCE",
        "replace_table_cell_text supports table elements only.",
        {
          details: {
            objectId: operation.objectId,
            kind: pageElementInfo.kind
          }
        }
      );
    }

    if (operation.mode === "replace_shape_text") {
      requests.push({
        deleteText: {
          objectId: operation.objectId,
          textRange: {
            type: "ALL"
          }
        }
      });

      if (operation.text.length > 0) {
        requests.push({
          insertText: {
            objectId: operation.objectId,
            text: operation.text,
            insertionIndex: 0
          }
        });
      }

      resolvedOperations.push({
        mode: operation.mode,
        objectId: operation.objectId,
        text: operation.text,
        slideNumber: pageElementInfo.slideNumber,
        slideObjectId: pageElementInfo.slideObjectId,
        sheetRowNumber: operation.sheetRowNumber,
        requestStartIndex,
        requestCount: operation.text.length > 0 ? 2 : 1
      });
      return;
    }

    if (operation.rowIndex >= (pageElementInfo.rowCount ?? 0)) {
      throw new AppError(
        "INVALID_SOURCE",
        "replace_table_cell_text row_index is outside the table bounds.",
        {
          details: {
            objectId: operation.objectId,
            rowIndex: operation.rowIndex,
            rowCount: pageElementInfo.rowCount ?? 0
          }
        }
      );
    }

    const columnCountForRow =
      pageElementInfo.columnCounts?.[operation.rowIndex] ?? 0;
    if (operation.columnIndex >= columnCountForRow) {
      throw new AppError(
        "INVALID_SOURCE",
        "replace_table_cell_text column_index is outside the table bounds.",
        {
          details: {
            objectId: operation.objectId,
            rowIndex: operation.rowIndex,
            columnIndex: operation.columnIndex,
            columnCount: columnCountForRow
          }
        }
      );
    }

    const cellLocation = {
      rowIndex: operation.rowIndex,
      columnIndex: operation.columnIndex
    };

    requests.push({
      deleteText: {
        objectId: operation.objectId,
        cellLocation,
        textRange: {
          type: "ALL"
        }
      }
    });

    if (operation.text.length > 0) {
      requests.push({
        insertText: {
          objectId: operation.objectId,
          cellLocation,
          text: operation.text,
          insertionIndex: 0
        }
      });
    }

    resolvedOperations.push({
      mode: operation.mode,
      objectId: operation.objectId,
      rowIndex: operation.rowIndex,
      columnIndex: operation.columnIndex,
      text: operation.text,
      slideNumber: pageElementInfo.slideNumber,
      slideObjectId: pageElementInfo.slideObjectId,
      sheetRowNumber: operation.sheetRowNumber,
      requestStartIndex,
      requestCount: operation.text.length > 0 ? 2 : 1
    });
  });

  return {
    requests,
    operations: resolvedOperations
  };
}

function normalizeWriteControl(writeControl) {
  if (!writeControl || typeof writeControl !== "object") {
    return null;
  }

  if (typeof writeControl.required_revision_id === "string") {
    return {
      requiredRevisionId: writeControl.required_revision_id
    };
  }

  return null;
}

async function batchUpdateGoogleSlide({
  presentationId,
  requests,
  accessToken,
  writeControl
}) {
  const response = await fetch(
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(
      presentationId
    )}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requests,
        ...(writeControl ? { writeControl } : {})
      })
    }
  );

  if (response.status === 404) {
    throw new AppError("NOT_FOUND", "Google Slide presentation not found.", {
      details: { presentationId }
    });
  }

  if (response.status === 403) {
    throw new AppError(
      "PERMISSION_DENIED",
      "Google Slides API denied write access to this presentation.",
      {
        details: { presentationId }
      }
    );
  }

  if (response.status === 400) {
    const responseText = await response.text();
    throw new AppError(
      "INVALID_SOURCE",
      "Google Slides API rejected the batch update request.",
      {
        details: { status: response.status, responseText }
      }
    );
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new AppError(
      "UPSTREAM_ERROR",
      "Google Slides API batch update failed.",
      {
        retryable: response.status >= 500,
        details: { status: response.status, responseText }
      }
    );
  }

  return response.json();
}

function summarizeOperationReplies(operations, replies) {
  return operations.map((operation) => {
    const summary = {
      ...operation
    };

    if (operation.mode === "replace_all_text") {
      const reply = replies[operation.requestStartIndex];
      summary.occurrencesChanged =
        reply?.replaceAllText?.occurrencesChanged ?? null;
    }

    delete summary.requestStartIndex;
    delete summary.requestCount;
    return summary;
  });
}

async function executeGoogleSlideOperations({
  resolvedSource,
  presentationPayload,
  operations,
  writeControl,
  dryRun
}) {
  const accessToken = await googleAuthProvider.getAccessToken();
  const { requests, operations: resolvedOperations } =
    buildSlideRequestsFromOperations({
      operations,
      presentationPayload
    });

  if (dryRun) {
    return {
      presentationId: resolvedSource.presentationId,
      sourceUrl: resolvedSource.sourceUrl,
      title: presentationPayload?.title ?? "Untitled Google Slide Deck",
      previousRevisionId: presentationPayload?.revisionId ?? null,
      dryRun: true,
      requestCount: requests.length,
      operationCount: resolvedOperations.length,
      operations: summarizeOperationReplies(resolvedOperations, []),
      replies: [],
      updatedRevisionId: presentationPayload?.revisionId ?? null,
      fetchedAt: new Date().toISOString()
    };
  }

  const response = await batchUpdateGoogleSlide({
    presentationId: resolvedSource.presentationId,
    requests,
    accessToken,
    writeControl
  });

  return {
    presentationId: resolvedSource.presentationId,
    sourceUrl: resolvedSource.sourceUrl,
    title: presentationPayload?.title ?? "Untitled Google Slide Deck",
    previousRevisionId: presentationPayload?.revisionId ?? null,
    dryRun: false,
    requestCount: requests.length,
    operationCount: resolvedOperations.length,
    operations: summarizeOperationReplies(
      resolvedOperations,
      response?.replies ?? []
    ),
    replies: response?.replies ?? [],
    updatedRevisionId:
      response?.writeControl?.requiredRevisionId ??
      presentationPayload?.revisionId ??
      null,
    fetchedAt: new Date().toISOString()
  };
}

function resolveColumnIndex(headerIndex, configuredName, aliases) {
  const candidates = [
    configuredName ? normalizeHeaderKey(configuredName) : null,
    ...aliases
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (headerIndex.has(candidate)) {
      return headerIndex.get(candidate);
    }
  }

  return null;
}

function valueAt(row, columnIndex) {
  if (columnIndex === null || columnIndex === undefined) {
    return "";
  }

  return String(row?.[columnIndex] ?? "").trim();
}

function pickMappedValue(row, primaryColumnIndex, secondaryColumnIndex) {
  if (primaryColumnIndex !== null && primaryColumnIndex !== undefined) {
    return valueAt(row, primaryColumnIndex);
  }

  return valueAt(row, secondaryColumnIndex);
}

function normalizeSheetMappingMode(value) {
  const normalized = normalizeHeaderKey(value);

  if (!normalized) {
    return null;
  }

  if (normalized === "replace_all_text" || normalized === "replacealltext") {
    return "replace_all_text";
  }

  if (normalized === "replace_shape_text" || normalized === "replaceshapetext") {
    return "replace_shape_text";
  }

  return null;
}

function parseSlideReference(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return {
      slideNumber: null,
      slideObjectId: null
    };
  }

  if (/^\d+$/.test(normalized)) {
    return {
      slideNumber: Number(normalized),
      slideObjectId: null
    };
  }

  return {
    slideNumber: null,
    slideObjectId: normalized
  };
}

function normalizeSheetMappingConfig(mapping) {
  return {
    headerRow: Number(mapping?.header_row ?? 1),
    modeColumn: mapping?.mode_column ?? "mode",
    placeholderColumn: mapping?.placeholder_column ?? "placeholder",
    valueColumn: mapping?.value_column ?? "value",
    slideColumn: mapping?.slide_column ?? "slide",
    objectIdColumn: mapping?.object_id_column ?? "object_id",
    textColumn: mapping?.text_column ?? "text",
    enabledColumn: mapping?.enabled_column ?? "enabled",
    matchCaseColumn: mapping?.match_case_column ?? "match_case",
    defaultMatchCase:
      mapping?.default_match_case === undefined
        ? true
        : Boolean(mapping.default_match_case)
  };
}

export function planGoogleSlideSheetMappings({
  rows,
  mapping
}) {
  const config = normalizeSheetMappingConfig(mapping);
  if (!Number.isInteger(config.headerRow) || config.headerRow < 1) {
    throw new AppError(
      "INVALID_SOURCE",
      "mapping.header_row must be a positive integer."
    );
  }

  if (!Array.isArray(rows) || rows.length < config.headerRow) {
    throw new AppError(
      "INVALID_SOURCE",
      "Google Sheet does not contain the configured header row."
    );
  }

  const headerRow = rows[config.headerRow - 1];
  const headerIndex = new Map();
  headerRow.forEach((cell, index) => {
    const key = normalizeHeaderKey(cell);
    if (key && !headerIndex.has(key)) {
      headerIndex.set(key, index);
    }
  });

  const columnIndex = {
    mode: resolveColumnIndex(headerIndex, config.modeColumn, COLUMN_ALIASES.mode),
    placeholder: resolveColumnIndex(
      headerIndex,
      config.placeholderColumn,
      COLUMN_ALIASES.placeholder
    ),
    value: resolveColumnIndex(headerIndex, config.valueColumn, COLUMN_ALIASES.value),
    slide: resolveColumnIndex(headerIndex, config.slideColumn, COLUMN_ALIASES.slide),
    objectId: resolveColumnIndex(
      headerIndex,
      config.objectIdColumn,
      COLUMN_ALIASES.objectId
    ),
    text: resolveColumnIndex(headerIndex, config.textColumn, COLUMN_ALIASES.text),
    enabled: resolveColumnIndex(
      headerIndex,
      config.enabledColumn,
      COLUMN_ALIASES.enabled
    ),
    matchCase: resolveColumnIndex(
      headerIndex,
      config.matchCaseColumn,
      COLUMN_ALIASES.matchCase
    )
  };

  if (columnIndex.placeholder === null && columnIndex.objectId === null) {
    throw new AppError(
      "INVALID_SOURCE",
      "Sheet mapping must provide either a placeholder column or an object_id column.",
      {
        details: {
          headers: headerRow
        }
      }
    );
  }

  const operations = [];
  const skippedRows = [];

  for (let rowIndex = config.headerRow; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowNumber = rowIndex + 1;
    const modeValue = valueAt(row, columnIndex.mode);
    const objectId = valueAt(row, columnIndex.objectId);
    const placeholder = valueAt(row, columnIndex.placeholder);
    const replaceValue = valueAt(row, columnIndex.value);
    const shapeText = valueAt(row, columnIndex.text);
    const slideValue = valueAt(row, columnIndex.slide);
    const enabled = normalizeBooleanish(
      valueAt(row, columnIndex.enabled),
      true
    );
    const matchCase = normalizeBooleanish(
      valueAt(row, columnIndex.matchCase),
      config.defaultMatchCase
    );

    const explicitMode = normalizeSheetMappingMode(modeValue);
    if (modeValue && !explicitMode) {
      throw new AppError(
        "INVALID_SOURCE",
        `Sheet row ${rowNumber} has unsupported mode: ${modeValue}.`
      );
    }

    const inferredMode =
      explicitMode ??
      (objectId ? "replace_shape_text" : placeholder ? "replace_all_text" : null);

    const blankRow =
      !modeValue &&
      !objectId &&
      !placeholder &&
      !replaceValue &&
      !shapeText &&
      !slideValue;

    if (!enabled || blankRow || !inferredMode) {
      skippedRows.push({
        rowNumber,
        reason: !enabled ? "disabled" : "blank"
      });
      continue;
    }

    if (inferredMode === "replace_shape_text") {
      if (!objectId) {
        throw new AppError(
          "INVALID_SOURCE",
          `Sheet row ${rowNumber} is missing object_id for replace_shape_text.`
        );
      }

      operations.push({
        mode: "replace_shape_text",
        object_id: objectId,
        text: pickMappedValue(row, columnIndex.text, columnIndex.value),
        sheet_row_number: rowNumber
      });
      continue;
    }

    if (!placeholder) {
      throw new AppError(
        "INVALID_SOURCE",
        `Sheet row ${rowNumber} is missing placeholder for replace_all_text.`
      );
    }

    const slideReference = parseSlideReference(slideValue);

    operations.push({
      mode: "replace_all_text",
      match_text: placeholder,
      replace_text: pickMappedValue(row, columnIndex.value, columnIndex.text),
      slide_number: slideReference.slideNumber,
      slide_object_id: slideReference.slideObjectId,
      match_case: matchCase,
      sheet_row_number: rowNumber
    });
  }

  return {
    operations,
    summary: {
      headerRow: config.headerRow,
      totalRows: rows.length,
      dataRows: Math.max(0, rows.length - config.headerRow),
      plannedOperations: operations.length,
      skippedRows
    },
    headers: headerRow
  };
}

export async function readGoogleSlide(source) {
  const resolvedSource = resolveGoogleSlideSource(source);
  const accessToken = await googleAuthProvider.getAccessToken();
  const payload = await fetchGoogleSlidePresentation(
    resolvedSource.presentationId,
    accessToken
  );
  const normalized = normalizeGoogleSlidePayload(payload);

  return {
    sourceId: resolvedSource.presentationId,
    sourceUrl: resolvedSource.sourceUrl,
    fetchedAt: new Date().toISOString(),
    ...normalized
  };
}

export async function writeGoogleSlide({
  source,
  operations,
  writeControl,
  dryRun = false
}) {
  const resolvedSource = resolveGoogleSlideSource(source);
  const accessToken = await googleAuthProvider.getAccessToken();
  const presentationPayload = await fetchGoogleSlidePresentation(
    resolvedSource.presentationId,
    accessToken
  );

  return executeGoogleSlideOperations({
    resolvedSource,
    presentationPayload,
    operations,
    writeControl: normalizeWriteControl(writeControl),
    dryRun: Boolean(dryRun)
  });
}

export async function applyGoogleSheetMappingsToSlide({
  presentation,
  sheet,
  mapping,
  writeControl,
  dryRun = false
}) {
  const [sheetPayload, resolvedSource, accessToken] = await Promise.all([
    readGoogleSheet(sheet),
    Promise.resolve(resolveGoogleSlideSource(presentation)),
    googleAuthProvider.getAccessToken()
  ]);
  const presentationPayload = await fetchGoogleSlidePresentation(
    resolvedSource.presentationId,
    accessToken
  );
  const plan = planGoogleSlideSheetMappings({
    rows: sheetPayload.rows,
    mapping
  });
  const result = await executeGoogleSlideOperations({
    resolvedSource,
    presentationPayload,
    operations: plan.operations,
    writeControl: normalizeWriteControl(writeControl),
    dryRun: Boolean(dryRun)
  });

  return {
    ...result,
    sheet: {
      title: sheetPayload.title,
      sheetTitle: sheetPayload.sheetTitle,
      sheetId: sheetPayload.sheetId,
      requestedRange: sheetPayload.requestedRange,
      sourceUrl: sheetPayload.sourceUrl
    },
    mappingSummary: plan.summary
  };
}
