import { AppError } from "../errors.js";
import { resolveGoogleDriveFolderSource } from "../lib/googleLinks.js";
import { googleAuthProvider } from "./auth.js";
import { readGoogleDoc } from "./docs.js";
import {
  createGoogleDriveGrant,
  getGoogleDriveGrant,
  requireGrantedItem,
  requireGrantedFolder,
  updateGoogleDriveGrantDiscoveredItems
} from "./driveGrants.js";
import { readGoogleSheet } from "./sheets.js";
import { readGoogleSlide } from "./slides.js";

const GOOGLE_DRIVE_METADATA_READ_SCOPE =
  "https://www.googleapis.com/auth/drive.metadata.readonly";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_MAX_DEPTH = 5;
const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDE_MIME_TYPE = "application/vnd.google-apps.presentation";

function normalizeBoolean(value) {
  return value === true;
}

function normalizePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new AppError(
      "INVALID_INPUT",
      "Expected a positive integer for this option."
    );
  }

  return normalized;
}

function normalizeNonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new AppError(
      "INVALID_INPUT",
      "Expected a non-negative integer for this option."
    );
  }

  return normalized;
}

function normalizeOwnerList(owners) {
  return Array.isArray(owners)
    ? owners.map((owner) => ({
        displayName: owner?.displayName ?? null,
        emailAddress: owner?.emailAddress ?? null
      }))
    : [];
}

function buildDriveFileUrl(file) {
  const mimeType = file?.mimeType ?? "";

  if (mimeType === GOOGLE_DOC_MIME_TYPE) {
    return `https://docs.google.com/document/d/${file.id}/edit`;
  }

  if (mimeType === GOOGLE_SHEET_MIME_TYPE) {
    return `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
  }

  if (mimeType === GOOGLE_SLIDE_MIME_TYPE) {
    return `https://docs.google.com/presentation/d/${file.id}/edit`;
  }

  if (mimeType === FOLDER_MIME_TYPE) {
    return `https://drive.google.com/drive/folders/${file.id}`;
  }

  return file?.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`;
}

function normalizeDriveItem(file, parentPath, depth) {
  const name = file?.name ?? "Untitled";
  const isFolder = file?.mimeType === FOLDER_MIME_TYPE;
  const path = parentPath ? `${parentPath}/${name}` : name;

  return {
    id: file?.id ?? null,
    name,
    mimeType: file?.mimeType ?? null,
    kind: isFolder ? "folder" : "file",
    isFolder,
    path,
    depth,
    webViewLink: buildDriveFileUrl(file),
    driveId: file?.driveId ?? null,
    resourceKey: file?.resourceKey ?? null,
    createdTime: file?.createdTime ?? null,
    modifiedTime: file?.modifiedTime ?? null,
    size: file?.size ?? null,
    shortcutDetails: file?.shortcutDetails ?? null,
    owners: normalizeOwnerList(file?.owners),
    parents: Array.isArray(file?.parents) ? file.parents : []
  };
}

function sortDriveItems(items) {
  return [...items].sort((left, right) => {
    if (left.isFolder !== right.isFolder) {
      return left.isFolder ? -1 : 1;
    }

    return left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
      numeric: true
    });
  });
}

async function driveRequest(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 404) {
    throw new AppError("NOT_FOUND", "Google Drive folder was not found.");
  }

  if (response.status === 403) {
    throw new AppError(
      "PERMISSION_DENIED",
      "Google Drive API denied access to this folder."
    );
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new AppError("UPSTREAM_ERROR", "Google Drive API request failed.", {
      retryable: response.status >= 500,
      details: {
        status: response.status,
        responseText
      }
    });
  }

  return response.json();
}

async function fetchFolderMetadata(folderId, accessToken) {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`
  );
  url.searchParams.set(
    "fields",
    [
      "id",
      "name",
      "mimeType",
      "webViewLink",
      "driveId",
      "resourceKey",
      "createdTime",
      "modifiedTime",
      "owners(displayName,emailAddress)",
      "parents"
    ].join(",")
  );
  url.searchParams.set("supportsAllDrives", "true");

  return driveRequest(url, accessToken);
}

async function fetchFolderChildren({
  folderId,
  accessToken,
  pageSize,
  pageToken
}) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set(
    "q",
    `'${folderId}' in parents and trashed = false`
  );
  url.searchParams.set(
    "fields",
    [
      "nextPageToken",
      "incompleteSearch",
      "files(" +
        [
          "id",
          "name",
          "mimeType",
          "webViewLink",
          "driveId",
          "resourceKey",
          "createdTime",
          "modifiedTime",
          "size",
          "parents",
          "owners(displayName,emailAddress)",
          "shortcutDetails(targetId,targetMimeType,targetResourceKey)"
        ].join(",") +
        ")"
    ].join(",")
  );
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("orderBy", "folder,name_natural");
  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

  return driveRequest(url, accessToken);
}

export function normalizeGoogleDriveFolderListingPayload({
  grant,
  targetFolder,
  items,
  recursive,
  maxDepth,
  nextPageToken,
  incompleteSearch
}) {
  return {
    grantId: grant.grantId,
    rootFolderId: grant.rootFolderId,
    rootFolderName: grant.rootFolderName,
    sourceUrl: grant.sourceUrl,
    fetchedAt: new Date().toISOString(),
    recursive,
    maxDepth,
    incompleteSearch: Boolean(incompleteSearch),
    nextPageToken: nextPageToken ?? null,
    folder: targetFolder,
    itemCount: items.length,
    items: sortDriveItems(items),
    folders: items.filter((item) => item.isFolder).length,
    files: items.filter((item) => !item.isFolder).length
  };
}

async function collectRecursiveItems({
  accessToken,
  folderId,
  parentPath,
  depth,
  maxDepth,
  pageSize
}) {
  const items = [];
  const queue = [{ folderId, parentPath, depth }];

  while (queue.length > 0) {
    const current = queue.shift();
    let pageToken = null;

    do {
      const page = await fetchFolderChildren({
        folderId: current.folderId,
        accessToken,
        pageSize,
        pageToken
      });

      for (const file of page.files ?? []) {
        const item = normalizeDriveItem(file, current.parentPath, current.depth);
        items.push(item);
        if (item.isFolder && current.depth < maxDepth) {
          queue.push({
            folderId: item.id,
            parentPath: item.path,
            depth: current.depth + 1
          });
        }
      }

      pageToken = page.nextPageToken ?? null;
    } while (pageToken);
  }

  return items;
}

export function inferReadableGoogleWorkspaceKind(item) {
  switch (item?.mimeType) {
    case GOOGLE_DOC_MIME_TYPE:
      return "google_doc";
    case GOOGLE_SHEET_MIME_TYPE:
      return "google_sheet";
    case GOOGLE_SLIDE_MIME_TYPE:
      return "google_slide";
    default:
      return null;
  }
}

async function getDriveAccessToken() {
  return googleAuthProvider.getAccessToken([GOOGLE_DRIVE_METADATA_READ_SCOPE]);
}

async function fetchAuthorizedRootFolder(source, accessToken) {
  const resolvedSource = resolveGoogleDriveFolderSource(source);
  const folderMetadata = await fetchFolderMetadata(
    resolvedSource.folderId,
    accessToken
  );

  if (folderMetadata?.mimeType !== FOLDER_MIME_TYPE) {
    throw new AppError(
      "INVALID_SOURCE",
      "The provided Google Drive source is not a folder."
    );
  }

  return {
    resolvedSource,
    folder: normalizeDriveItem(folderMetadata, "", 0)
  };
}

export async function authorizeGoogleDriveRoot({
  source,
  ttlHours,
  confirmGrant
}) {
  const accessToken = await getDriveAccessToken();
  const { resolvedSource, folder } = await fetchAuthorizedRootFolder(
    source,
    accessToken
  );

  if (typeof confirmGrant !== "function") {
    throw new AppError(
      "CONFIRMATION_REQUIRED",
      "google_drive_authorize_root requires an explicit confirmation step."
    );
  }

  const confirmed = await confirmGrant({
    folderId: folder.id,
    folderName: folder.name,
    sourceUrl: resolvedSource.sourceUrl,
    ttlHours: normalizePositiveInteger(ttlHours, 8)
  });

  if (!confirmed) {
    return {
      authorized: false,
      cancelled: true,
      sourceUrl: resolvedSource.sourceUrl,
      rootFolder: folder
    };
  }

  return {
    authorized: true,
    cancelled: false,
    ...createGoogleDriveGrant({
      rootFolder: folder,
      sourceUrl: resolvedSource.sourceUrl,
      ttlHours
    })
  };
}

export async function listGoogleDriveFolder({
  grantId,
  folderId = null,
  recursive = false,
  maxDepth = DEFAULT_MAX_DEPTH,
  pageSize = DEFAULT_PAGE_SIZE,
  pageToken = null
}) {
  if (!grantId) {
    throw new AppError(
      "INVALID_INPUT",
      "grant_id is required. Call google_drive_authorize_root first."
    );
  }

  const grant = getGoogleDriveGrant(grantId);
  const targetFolderId = folderId ?? grant.rootFolderId;
  const authorizedFolder = requireGrantedFolder(grant, targetFolderId);
  const normalizedRecursive = normalizeBoolean(recursive);
  const normalizedPageSize = Math.min(
    normalizePositiveInteger(pageSize, DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
  );
  const normalizedMaxDepth = normalizeNonNegativeInteger(
    maxDepth,
    DEFAULT_MAX_DEPTH
  );
  const accessToken = await getDriveAccessToken();

  if (normalizedRecursive) {
    const items = await collectRecursiveItems({
      accessToken,
      folderId: targetFolderId,
      parentPath: authorizedFolder.path,
      depth: authorizedFolder.depth + 1,
      maxDepth: normalizedMaxDepth,
      pageSize: normalizedPageSize
    });
    updateGoogleDriveGrantDiscoveredItems(grantId, items);

    return normalizeGoogleDriveFolderListingPayload({
      grant,
      targetFolder: authorizedFolder,
      items,
      recursive: true,
      maxDepth: normalizedMaxDepth,
      nextPageToken: null,
      incompleteSearch: false
    });
  }

  const page = await fetchFolderChildren({
    folderId: targetFolderId,
    accessToken,
    pageSize: normalizedPageSize,
    pageToken
  });
  const items = (page.files ?? []).map((file) =>
    normalizeDriveItem(file, authorizedFolder.path, authorizedFolder.depth + 1)
  );
  updateGoogleDriveGrantDiscoveredItems(grantId, items);

  return normalizeGoogleDriveFolderListingPayload({
    grant,
    targetFolder: authorizedFolder,
    items,
    recursive: false,
    maxDepth: normalizedMaxDepth,
    nextPageToken: page.nextPageToken ?? null,
    incompleteSearch: page.incompleteSearch ?? false
  });
}

export async function readGoogleDriveGrantedItem({
  grantId,
  itemId,
  sheet,
  gid,
  range
}) {
  if (!grantId) {
    throw new AppError(
      "INVALID_INPUT",
      "grant_id is required. Call google_drive_authorize_root first."
    );
  }

  if (!itemId) {
    throw new AppError(
      "INVALID_INPUT",
      "item_id is required to read a Google Drive item."
    );
  }

  const grant = getGoogleDriveGrant(grantId);
  const item = requireGrantedItem(grant, itemId);
  const readableKind = inferReadableGoogleWorkspaceKind(item);

  if (!readableKind) {
    throw new AppError(
      "INVALID_SOURCE",
      "This Drive item is not a supported Google Doc / Sheet / Slide file.",
      {
        details: {
          itemId,
          mimeType: item.mimeType
        }
      }
    );
  }

  if (readableKind === "google_doc") {
    const data = await readGoogleDoc({ id: item.id });
    return {
      grantId,
      item,
      readableKind,
      data
    };
  }

  if (readableKind === "google_sheet") {
    const data = await readGoogleSheet({
      id: item.id,
      sheet,
      gid,
      range
    });
    return {
      grantId,
      item,
      readableKind,
      data
    };
  }

  const data = await readGoogleSlide({ id: item.id });
  return {
    grantId,
    item,
    readableKind,
    data
  };
}
