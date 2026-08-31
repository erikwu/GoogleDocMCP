import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "../errors.js";

const DEFAULT_GRANT_TTL_HOURS = 8;
const MAX_GRANT_TTL_HOURS = 24 * 7;

function resolveStateDir() {
  const fromEnv = process.env.GOOGLE_WORKSPACE_MCP_STATE_DIR;
  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  return path.resolve(process.cwd(), ".codex");
}

function resolveGrantStorePath() {
  return path.join(resolveStateDir(), "google-drive-grants.json");
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function readGrantStore() {
  const filePath = resolveGrantStorePath();

  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      grants: []
    };
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    version: 1,
    grants: Array.isArray(raw?.grants) ? raw.grants : []
  };
}

function writeGrantStore(store) {
  const filePath = resolveGrantStorePath();
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
}

function normalizePositiveHours(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_GRANT_TTL_HOURS;
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new AppError(
      "INVALID_INPUT",
      "ttl_hours must be a positive number."
    );
  }

  return Math.min(normalized, MAX_GRANT_TTL_HOURS);
}

function purgeExpiredGrants(store, now = Date.now()) {
  return {
    ...store,
    grants: store.grants.filter((grant) => {
      const expiresAt = Date.parse(grant?.expiresAt ?? "");
      return Number.isFinite(expiresAt) && expiresAt > now;
    })
  };
}

function summarizeGrant(grant) {
  return {
    grantId: grant.grantId,
    rootFolderId: grant.rootFolderId,
    rootFolderName: grant.rootFolderName,
    sourceUrl: grant.sourceUrl,
    createdAt: grant.createdAt,
    expiresAt: grant.expiresAt,
    discoveredItemCount: Object.keys(grant.discoveredItems ?? {}).length
  };
}

export function buildGrantDiscoveredItem(item) {
  return {
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    kind: item.kind,
    isFolder: item.isFolder,
    path: item.path,
    depth: item.depth,
    webViewLink: item.webViewLink ?? null,
    parents: Array.isArray(item.parents) ? item.parents : []
  };
}

export function createGoogleDriveGrant({ rootFolder, sourceUrl, ttlHours }) {
  const normalizedTtlHours = normalizePositiveHours(ttlHours);
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + normalizedTtlHours * 60 * 60 * 1000
  );
  const rootItem = buildGrantDiscoveredItem(rootFolder);

  const store = purgeExpiredGrants(readGrantStore());
  const grant = {
    grantId: `gdrv_${crypto.randomUUID()}`,
    rootFolderId: rootFolder.id,
    rootFolderName: rootFolder.name,
    sourceUrl,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    discoveredItems: {
      [rootFolder.id]: rootItem
    }
  };

  store.grants.push(grant);
  writeGrantStore(store);

  return {
    ...summarizeGrant(grant),
    rootFolder: rootItem
  };
}

export function getGoogleDriveGrant(grantId) {
  const store = purgeExpiredGrants(readGrantStore());
  writeGrantStore(store);

  const grant = store.grants.find((entry) => entry.grantId === grantId);
  if (!grant) {
    throw new AppError(
      "NOT_FOUND",
      "Google Drive grant was not found or has expired.",
      { details: { grantId } }
    );
  }

  return grant;
}

export function updateGoogleDriveGrantDiscoveredItems(grantId, items) {
  const store = purgeExpiredGrants(readGrantStore());
  const grant = store.grants.find((entry) => entry.grantId === grantId);
  if (!grant) {
    throw new AppError(
      "NOT_FOUND",
      "Google Drive grant was not found or has expired.",
      { details: { grantId } }
    );
  }

  const discoveredItems = {
    ...(grant.discoveredItems ?? {})
  };

  for (const item of items) {
    discoveredItems[item.id] = buildGrantDiscoveredItem(item);
  }

  grant.discoveredItems = discoveredItems;
  writeGrantStore(store);

  return summarizeGrant(grant);
}

export function requireGrantedFolder(grant, folderId) {
  const item = grant?.discoveredItems?.[folderId];
  if (!item) {
    throw new AppError(
      "PERMISSION_DENIED",
      "This folder is outside the currently authorized Google Drive subtree.",
      {
        details: {
          folderId,
          grantId: grant?.grantId ?? null
        }
      }
    );
  }

  if (!item.isFolder) {
    throw new AppError("INVALID_SOURCE", "The requested item is not a folder.", {
      details: {
        folderId,
        grantId: grant?.grantId ?? null
      }
    });
  }

  return item;
}

export function requireGrantedItem(grant, itemId) {
  const item = grant?.discoveredItems?.[itemId];
  if (!item) {
    throw new AppError(
      "PERMISSION_DENIED",
      "This item is outside the currently authorized Google Drive subtree.",
      {
        details: {
          itemId,
          grantId: grant?.grantId ?? null
        }
      }
    );
  }

  return item;
}

export function listGoogleDriveGrants() {
  const store = purgeExpiredGrants(readGrantStore());
  writeGrantStore(store);
  return store.grants.map(summarizeGrant);
}

export function clearGoogleDriveGrantStoreForTests() {
  const filePath = resolveGrantStorePath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function getGoogleDriveGrantStorePathForTests() {
  return resolveGrantStorePath();
}
