import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  clearGoogleDriveGrantStoreForTests,
  createGoogleDriveGrant,
  getGoogleDriveGrant,
  getGoogleDriveGrantStorePathForTests,
  requireGrantedItem,
  requireGrantedFolder,
  updateGoogleDriveGrantDiscoveredItems
} from "../src/google/driveGrants.js";

function withTempStateDir(run) {
  const previous = process.env.GOOGLE_WORKSPACE_MCP_STATE_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdmcp-grants-"));
  process.env.GOOGLE_WORKSPACE_MCP_STATE_DIR = tempDir;

  try {
    clearGoogleDriveGrantStoreForTests();
    run(tempDir);
  } finally {
    if (previous === undefined) {
      delete process.env.GOOGLE_WORKSPACE_MCP_STATE_DIR;
    } else {
      process.env.GOOGLE_WORKSPACE_MCP_STATE_DIR = previous;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("createGoogleDriveGrant persists root grant and root discovery", () => {
  withTempStateDir(() => {
    const created = createGoogleDriveGrant({
      rootFolder: {
        id: "root-1",
        name: "Root",
        mimeType: "application/vnd.google-apps.folder",
        kind: "folder",
        isFolder: true,
        path: "Root",
        depth: 0,
        parents: []
      },
      sourceUrl: "https://drive.google.com/drive/folders/root-1",
      ttlHours: 4
    });

    assert.match(created.grantId, /^gdrv_/);
    assert.equal(created.rootFolder.id, "root-1");
    assert.equal(
      getGoogleDriveGrantStorePathForTests(),
      path.join(process.env.GOOGLE_WORKSPACE_MCP_STATE_DIR, "google-drive-grants.json")
    );

    const loaded = getGoogleDriveGrant(created.grantId);
    assert.equal(loaded.rootFolderId, "root-1");
    assert.equal(loaded.discoveredItems["root-1"].path, "Root");
  });
});

test("updateGoogleDriveGrantDiscoveredItems expands authorized subtree", () => {
  withTempStateDir(() => {
    const created = createGoogleDriveGrant({
      rootFolder: {
        id: "root-1",
        name: "Root",
        mimeType: "application/vnd.google-apps.folder",
        kind: "folder",
        isFolder: true,
        path: "Root",
        depth: 0,
        parents: []
      },
      sourceUrl: "https://drive.google.com/drive/folders/root-1"
    });

    updateGoogleDriveGrantDiscoveredItems(created.grantId, [
      {
        id: "sub-1",
        name: "Sub Folder",
        mimeType: "application/vnd.google-apps.folder",
        kind: "folder",
        isFolder: true,
        path: "Root/Sub Folder",
        depth: 1,
        parents: ["root-1"]
      }
    ]);

    const loaded = getGoogleDriveGrant(created.grantId);
    const folder = requireGrantedFolder(loaded, "sub-1");
    assert.equal(folder.path, "Root/Sub Folder");
    const item = requireGrantedItem(loaded, "sub-1");
    assert.equal(item.name, "Sub Folder");
  });
});
