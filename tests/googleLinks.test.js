import test from "node:test";
import assert from "node:assert/strict";
import {
  extractGoogleDocUrls,
  parseGoogleDocUrl,
  parseGoogleDriveFolderUrl,
  resolveGoogleDocSource
} from "../src/lib/googleLinks.js";

test("parseGoogleDocUrl extracts doc id and canonical url", () => {
  const parsed = parseGoogleDocUrl(
    "https://docs.google.com/document/d/abc123XYZ/edit?tab=t.0"
  );

  assert.equal(parsed.documentId, "abc123XYZ");
  assert.equal(
    parsed.canonicalUrl,
    "https://docs.google.com/document/d/abc123XYZ/edit"
  );
});

test("extractGoogleDocUrls finds multiple doc links", () => {
  const urls = extractGoogleDocUrls(
    "A https://docs.google.com/document/d/one/edit and B https://docs.google.com/document/d/two/edit"
  );

  assert.deepEqual(urls, [
    "https://docs.google.com/document/d/one/edit",
    "https://docs.google.com/document/d/two/edit"
  ]);
});

test("resolveGoogleDocSource supports source id only", () => {
  const resolved = resolveGoogleDocSource({ id: "xyz" });
  assert.equal(resolved.documentId, "xyz");
  assert.equal(
    resolved.sourceUrl,
    "https://docs.google.com/document/d/xyz/edit"
  );
});

test("parseGoogleDriveFolderUrl extracts folder id and canonical url", () => {
  const parsed = parseGoogleDriveFolderUrl(
    "https://drive.google.com/drive/u/0/folders/1UWjRbSk0s1ZmzcUfN6zNvk1Fnb9PNbC9"
  );

  assert.equal(parsed.folderId, "1UWjRbSk0s1ZmzcUfN6zNvk1Fnb9PNbC9");
  assert.equal(
    parsed.canonicalUrl,
    "https://drive.google.com/drive/folders/1UWjRbSk0s1ZmzcUfN6zNvk1Fnb9PNbC9"
  );
});
