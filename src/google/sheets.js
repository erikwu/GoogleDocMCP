import { getConfig } from "../config.js";
import { AppError } from "../errors.js";
import { resolveGoogleSheetSource } from "../lib/googleLinks.js";
import { googleAuthProvider } from "./auth.js";

const GOOGLE_SHEETS_READ_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, maxChars)}\n\n[truncated]`,
    truncated: true
  };
}

function normalizeRows(values) {
  const rows = Array.isArray(values) ? values : [];

  return rows.map((row) =>
    Array.isArray(row) ? row.map((value) => String(value ?? "")) : []
  );
}

function quoteSheetTitle(sheetTitle) {
  return `'${String(sheetTitle ?? "").replace(/'/g, "''")}'`;
}

function resolveTargetSheet(metadataPayload, source) {
  const sheets = Array.isArray(metadataPayload?.sheets)
    ? metadataPayload.sheets.map((sheet) => ({
        sheetId: String(sheet?.properties?.sheetId ?? ""),
        title: sheet?.properties?.title ?? "Untitled Sheet",
        index: sheet?.properties?.index ?? 0,
        gridProperties: sheet?.properties?.gridProperties ?? {}
      }))
    : [];

  if (sheets.length === 0) {
    throw new AppError(
      "NOT_FOUND",
      "Google Sheet metadata did not contain any tabs."
    );
  }

  if (source.sheetName && source.gid) {
    const matched = sheets.find(
      (sheet) =>
        sheet.sheetId === String(source.gid) && sheet.title === source.sheetName
    );

    if (!matched) {
      throw new AppError(
        "INVALID_SOURCE",
        "Provided Google Sheet gid and sheet name do not point to the same tab.",
        {
          details: {
            gid: source.gid,
            sheetName: source.sheetName
          }
        }
      );
    }

    return {
      targetSheet: matched,
      availableSheets: sheets
    };
  }

  if (source.sheetName) {
    const exact = sheets.find((sheet) => sheet.title === source.sheetName);
    const fallback = sheets.find(
      (sheet) => sheet.title.toLowerCase() === source.sheetName.toLowerCase()
    );
    const matched = exact ?? fallback;

    if (!matched) {
      throw new AppError("NOT_FOUND", "Google Sheet tab was not found.", {
        details: {
          sheetName: source.sheetName,
          availableSheets: sheets.map((sheet) => sheet.title)
        }
      });
    }

    return {
      targetSheet: matched,
      availableSheets: sheets
    };
  }

  if (source.gid) {
    const matched = sheets.find((sheet) => sheet.sheetId === String(source.gid));

    if (!matched) {
      throw new AppError("NOT_FOUND", "Google Sheet gid was not found.", {
        details: {
          gid: source.gid,
          availableSheets: sheets.map((sheet) => ({
            sheetId: sheet.sheetId,
            title: sheet.title
          }))
        }
      });
    }

    return {
      targetSheet: matched,
      availableSheets: sheets
    };
  }

  return {
    targetSheet: [...sheets].sort((left, right) => left.index - right.index)[0],
    availableSheets: sheets
  };
}

function buildRequestedRange(source, targetSheet) {
  if (source.range) {
    if (source.range.includes("!")) {
      return source.range;
    }

    return `${quoteSheetTitle(targetSheet.title)}!${source.range}`;
  }

  return quoteSheetTitle(targetSheet.title);
}

export function normalizeGoogleSheetPayload({
  metadataPayload,
  valuesPayload,
  requestedRange,
  sourceUrl,
  targetSheet
}) {
  const config = getConfig();
  const rows = normalizeRows(valuesPayload?.values);
  const maxColumns = rows.reduce(
    (largest, row) => Math.max(largest, row.length),
    0
  );
  const normalizedRows = rows.map((row) => [
    ...row,
    ...Array(Math.max(0, maxColumns - row.length)).fill("")
  ]);
  const availableSheets = Array.isArray(metadataPayload?.sheets)
    ? metadataPayload.sheets.map((sheet) => ({
        sheetId: String(sheet?.properties?.sheetId ?? ""),
        title: sheet?.properties?.title ?? "Untitled Sheet",
        index: sheet?.properties?.index ?? 0,
        rowCount: sheet?.properties?.gridProperties?.rowCount ?? null,
        columnCount: sheet?.properties?.gridProperties?.columnCount ?? null
      }))
    : [];

  const markdown =
    normalizedRows.length === 0
      ? "_No cell values returned for this range._"
      : [
          `| ${Array.from(
            { length: maxColumns },
            (_, index) => `Column ${index + 1}`
          ).join(" | ")} |`,
          `| ${Array.from({ length: maxColumns }, () => "---").join(" | ")} |`,
          ...normalizedRows.map((row) => `| ${row.join(" | ")} |`)
        ].join("\n");
  const plainText = normalizedRows.map((row) => row.join("\t")).join("\n");
  const truncatedMarkdown = truncateText(markdown, config.limits.maxDocChars);
  const truncatedPlainText = truncateText(plainText, config.limits.maxDocChars);

  return {
    title: metadataPayload?.properties?.title ?? "Untitled Google Sheet",
    sheetTitle: targetSheet.title,
    sheetId: targetSheet.sheetId,
    requestedRange,
    returnedRange: valuesPayload?.range ?? requestedRange,
    markdown: truncatedMarkdown.text,
    plainText: truncatedPlainText.text,
    rows: normalizedRows,
    rowCount: normalizedRows.length,
    columnCount: maxColumns,
    availableSheets,
    truncated: truncatedMarkdown.truncated || truncatedPlainText.truncated,
    sourceUrl
  };
}

async function fetchSheetMetadata(spreadsheetId, accessToken) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}`
  );
  url.searchParams.set(
    "fields",
    "properties.title,sheets.properties(sheetId,title,index,gridProperties)"
  );

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 404) {
    throw new AppError("NOT_FOUND", "Google Sheet not found.", {
      details: { spreadsheetId }
    });
  }

  if (response.status === 403) {
    throw new AppError(
      "PERMISSION_DENIED",
      "Google Sheets API denied access to this spreadsheet.",
      {
        details: { spreadsheetId }
      }
    );
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new AppError(
      "UPSTREAM_ERROR",
      "Google Sheets API metadata request failed.",
      {
        retryable: response.status >= 500,
        details: { status: response.status, responseText }
      }
    );
  }

  return response.json();
}

async function fetchSheetValues(spreadsheetId, requestedRange, accessToken) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(requestedRange)}`
  );
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 400) {
    const responseText = await response.text();
    throw new AppError("INVALID_SOURCE", "Google Sheet range is invalid.", {
      details: {
        requestedRange,
        responseText
      }
    });
  }

  if (response.status === 404) {
    throw new AppError("NOT_FOUND", "Google Sheet values were not found.", {
      details: {
        requestedRange
      }
    });
  }

  if (response.status === 403) {
    throw new AppError(
      "PERMISSION_DENIED",
      "Google Sheets API denied access to this range.",
      {
        details: { requestedRange }
      }
    );
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new AppError(
      "UPSTREAM_ERROR",
      "Google Sheets API values request failed.",
      {
        retryable: response.status >= 500,
        details: { status: response.status, responseText }
      }
    );
  }

  return response.json();
}

export async function readGoogleSheet(source) {
  const resolvedSource = resolveGoogleSheetSource(source);
  const accessToken = await googleAuthProvider.getAccessToken([
    GOOGLE_SHEETS_READ_SCOPE
  ]);
  const metadataPayload = await fetchSheetMetadata(
    resolvedSource.spreadsheetId,
    accessToken
  );
  const { targetSheet, availableSheets } = resolveTargetSheet(
    metadataPayload,
    resolvedSource
  );
  const requestedRange = buildRequestedRange(resolvedSource, targetSheet);
  const valuesPayload = await fetchSheetValues(
    resolvedSource.spreadsheetId,
    requestedRange,
    accessToken
  );
  const sourceUrl = `https://docs.google.com/spreadsheets/d/${resolvedSource.spreadsheetId}/edit#gid=${targetSheet.sheetId}`;
  const normalized = normalizeGoogleSheetPayload({
    metadataPayload: {
      ...metadataPayload,
      sheets: availableSheets.map((sheet) => ({
        properties: {
          sheetId: Number(sheet.sheetId),
          title: sheet.title,
          index: sheet.index,
          gridProperties: {
            rowCount: sheet.gridProperties?.rowCount ?? null,
            columnCount: sheet.gridProperties?.columnCount ?? null
          }
        }
      }))
    },
    valuesPayload,
    requestedRange,
    sourceUrl,
    targetSheet
  });

  return {
    sourceId: resolvedSource.spreadsheetId,
    fetchedAt: new Date().toISOString(),
    ...normalized
  };
}
