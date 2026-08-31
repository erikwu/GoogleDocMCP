import { AppError } from "../errors.js";

const GOOGLE_DOC_URL_PATTERN =
  /https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/i;
const GOOGLE_SHEET_URL_PATTERN =
  /https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/i;
const GOOGLE_SLIDE_URL_PATTERN =
  /https:\/\/docs\.google\.com\/presentation\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/i;
const GOOGLE_DRIVE_FOLDER_URL_PATTERN =
  /https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/i;
const GOOGLE_DRIVE_OPEN_URL_PATTERN =
  /https:\/\/drive\.google\.com\/open\?(?:.*&)?id=([a-zA-Z0-9_-]+)/i;

function normalizeSheetGid(gid) {
  if (gid === undefined || gid === null || gid === "") {
    return null;
  }

  return String(gid);
}

function parseGoogleSheetUrlState(url) {
  try {
    const parsed = new URL(url);
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    return {
      gid:
        normalizeSheetGid(parsed.searchParams.get("gid")) ??
        normalizeSheetGid(hashParams.get("gid")),
      range:
        parsed.searchParams.get("range") ?? hashParams.get("range") ?? null
    };
  } catch {
    return {
      gid: null,
      range: null
    };
  }
}

export function parseGoogleDocUrl(url) {
  if (typeof url !== "string") {
    throw new AppError("INVALID_LINK", "Google Doc URL must be a string.");
  }

  const match = url.match(GOOGLE_DOC_URL_PATTERN);
  if (!match) {
    throw new AppError("INVALID_LINK", "Unsupported Google Doc URL.", {
      details: { url }
    });
  }

  const documentId = match[1];
  return {
    documentId,
    canonicalUrl: `https://docs.google.com/document/d/${documentId}/edit`
  };
}

export function parseGoogleSheetUrl(url) {
  if (typeof url !== "string") {
    throw new AppError("INVALID_LINK", "Google Sheet URL must be a string.");
  }

  const match = url.match(GOOGLE_SHEET_URL_PATTERN);
  if (!match) {
    throw new AppError("INVALID_LINK", "Unsupported Google Sheet URL.", {
      details: { url }
    });
  }

  const spreadsheetId = match[1];
  const { gid, range } = parseGoogleSheetUrlState(url);
  const canonicalUrl = gid
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${gid}`
    : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  return {
    spreadsheetId,
    canonicalUrl,
    gid,
    range
  };
}

export function parseGoogleSlideUrl(url) {
  if (typeof url !== "string") {
    throw new AppError("INVALID_LINK", "Google Slide URL must be a string.");
  }

  const match = url.match(GOOGLE_SLIDE_URL_PATTERN);
  if (!match) {
    throw new AppError("INVALID_LINK", "Unsupported Google Slide URL.", {
      details: { url }
    });
  }

  const presentationId = match[1];
  return {
    presentationId,
    canonicalUrl: `https://docs.google.com/presentation/d/${presentationId}/edit`
  };
}

export function parseGoogleDriveFolderUrl(url) {
  if (typeof url !== "string") {
    throw new AppError(
      "INVALID_LINK",
      "Google Drive folder URL must be a string."
    );
  }

  const directMatch = url.match(GOOGLE_DRIVE_FOLDER_URL_PATTERN);
  const openMatch = url.match(GOOGLE_DRIVE_OPEN_URL_PATTERN);
  const match = directMatch ?? openMatch;

  if (!match) {
    throw new AppError("INVALID_LINK", "Unsupported Google Drive folder URL.", {
      details: { url }
    });
  }

  const folderId = match[1];
  return {
    folderId,
    canonicalUrl: `https://drive.google.com/drive/folders/${folderId}`
  };
}

export function extractGoogleDocUrls(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const matcher = new RegExp(GOOGLE_DOC_URL_PATTERN.source, "gi");
  const urls = [];
  let match;

  while ((match = matcher.exec(text))) {
    urls.push(parseGoogleDocUrl(match[0]).canonicalUrl);
  }

  return Array.from(new Set(urls));
}

export function resolveGoogleDocSource(source) {
  if (!source || typeof source !== "object") {
    throw new AppError("INVALID_SOURCE", "A Google Doc source is required.");
  }

  if (source.url) {
    const { documentId, canonicalUrl } = parseGoogleDocUrl(source.url);
    if (source.id && source.id !== documentId) {
      throw new AppError(
        "INVALID_SOURCE",
        "Provided Google Doc URL and id do not match."
      );
    }

    return {
      documentId,
      sourceUrl: canonicalUrl
    };
  }

  if (source.id) {
    return {
      documentId: source.id,
      sourceUrl: `https://docs.google.com/document/d/${source.id}/edit`
    };
  }

  throw new AppError(
    "INVALID_SOURCE",
    "Provide either a Google Doc URL or document id."
  );
}

export function resolveGoogleSheetSource(source) {
  if (!source || typeof source !== "object") {
    throw new AppError("INVALID_SOURCE", "A Google Sheet source is required.");
  }

  if (source.url) {
    const parsed = parseGoogleSheetUrl(source.url);
    if (source.id && source.id !== parsed.spreadsheetId) {
      throw new AppError(
        "INVALID_SOURCE",
        "Provided Google Sheet URL and id do not match."
      );
    }

    const gid = normalizeSheetGid(source.gid) ?? parsed.gid;
    if (
      normalizeSheetGid(source.gid) &&
      parsed.gid &&
      normalizeSheetGid(source.gid) !== parsed.gid
    ) {
      throw new AppError(
        "INVALID_SOURCE",
        "Provided Google Sheet URL and gid do not match."
      );
    }

    return {
      spreadsheetId: parsed.spreadsheetId,
      sourceUrl: gid
        ? `https://docs.google.com/spreadsheets/d/${parsed.spreadsheetId}/edit#gid=${gid}`
        : parsed.canonicalUrl,
      gid,
      sheetName: source.sheet ?? null,
      range: source.range ?? parsed.range ?? null
    };
  }

  if (source.id) {
    const gid = normalizeSheetGid(source.gid);
    return {
      spreadsheetId: source.id,
      sourceUrl: gid
        ? `https://docs.google.com/spreadsheets/d/${source.id}/edit#gid=${gid}`
        : `https://docs.google.com/spreadsheets/d/${source.id}/edit`,
      gid,
      sheetName: source.sheet ?? null,
      range: source.range ?? null
    };
  }

  throw new AppError(
    "INVALID_SOURCE",
    "Provide either a Google Sheet URL or spreadsheet id."
  );
}

export function resolveGoogleSlideSource(source) {
  if (!source || typeof source !== "object") {
    throw new AppError("INVALID_SOURCE", "A Google Slide source is required.");
  }

  if (source.url) {
    const { presentationId, canonicalUrl } = parseGoogleSlideUrl(source.url);
    if (source.id && source.id !== presentationId) {
      throw new AppError(
        "INVALID_SOURCE",
        "Provided Google Slide URL and id do not match."
      );
    }

    return {
      presentationId,
      sourceUrl: canonicalUrl
    };
  }

  if (source.id) {
    return {
      presentationId: source.id,
      sourceUrl: `https://docs.google.com/presentation/d/${source.id}/edit`
    };
  }

  throw new AppError(
    "INVALID_SOURCE",
    "Provide either a Google Slide URL or presentation id."
  );
}

export function resolveGoogleDriveFolderSource(source) {
  if (!source || typeof source !== "object") {
    throw new AppError(
      "INVALID_SOURCE",
      "A Google Drive folder source is required."
    );
  }

  if (source.url) {
    const { folderId, canonicalUrl } = parseGoogleDriveFolderUrl(source.url);
    if (source.id && source.id !== folderId) {
      throw new AppError(
        "INVALID_SOURCE",
        "Provided Google Drive folder URL and id do not match."
      );
    }

    return {
      folderId,
      sourceUrl: canonicalUrl
    };
  }

  if (source.id) {
    return {
      folderId: source.id,
      sourceUrl: `https://drive.google.com/drive/folders/${source.id}`
    };
  }

  throw new AppError(
    "INVALID_SOURCE",
    "Provide either a Google Drive folder URL or folder id."
  );
}
