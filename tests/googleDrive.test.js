import test from "node:test";
import assert from "node:assert/strict";
import {
  inferReadableGoogleWorkspaceKind,
  normalizeGoogleDriveFolderListingPayload
} from "../src/google/drive.js";

test("normalizeGoogleDriveFolderListingPayload sorts folders before files", () => {
  const payload = normalizeGoogleDriveFolderListingPayload({
    grant: {
      grantId: "gdrv_test",
      rootFolderId: "folder-1",
      rootFolderName: "Root Folder",
      sourceUrl: "https://drive.google.com/drive/folders/folder-1"
    },
    targetFolder: {
      id: "folder-1",
      name: "Root Folder",
      mimeType: "application/vnd.google-apps.folder",
      isFolder: true,
      path: "Root Folder",
      depth: 0
    },
    items: [
      {
        id: "file-2",
        name: "b.txt",
        mimeType: "text/plain",
        isFolder: false,
        path: "Root Folder/b.txt"
      },
      {
        id: "folder-2",
        name: "Docs",
        mimeType: "application/vnd.google-apps.folder",
        isFolder: true,
        path: "Root Folder/Docs"
      },
      {
        id: "file-1",
        name: "a.txt",
        mimeType: "text/plain",
        isFolder: false,
        path: "Root Folder/a.txt"
      }
    ],
    recursive: false,
    maxDepth: 5,
    nextPageToken: "token-1",
    incompleteSearch: false
  });

  assert.equal(payload.folder.name, "Root Folder");
  assert.equal(payload.itemCount, 3);
  assert.equal(payload.folders, 1);
  assert.equal(payload.files, 2);
  assert.equal(payload.nextPageToken, "token-1");
  assert.deepEqual(
    payload.items.map((item) => item.name),
    ["Docs", "a.txt", "b.txt"]
  );
  assert.equal(payload.grantId, "gdrv_test");
});

test("inferReadableGoogleWorkspaceKind recognizes supported Google file types", () => {
  assert.equal(
    inferReadableGoogleWorkspaceKind({
      mimeType: "application/vnd.google-apps.document"
    }),
    "google_doc"
  );
  assert.equal(
    inferReadableGoogleWorkspaceKind({
      mimeType: "application/vnd.google-apps.spreadsheet"
    }),
    "google_sheet"
  );
  assert.equal(
    inferReadableGoogleWorkspaceKind({
      mimeType: "application/vnd.google-apps.presentation"
    }),
    "google_slide"
  );
  assert.equal(
    inferReadableGoogleWorkspaceKind({
      mimeType: "application/pdf"
    }),
    null
  );
});
