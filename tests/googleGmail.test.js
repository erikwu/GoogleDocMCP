import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGmailRawMessage,
  normalizeMessagePayload
} from "../src/google/gmail.js";

function toBase64Url(text) {
  return Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

test("normalizeMessagePayload extracts headers and multipart bodies", () => {
  const message = normalizeMessagePayload(
    {
      id: "msg-1",
      threadId: "thread-1",
      labelIds: ["INBOX", "UNREAD"],
      snippet: "Fallback snippet",
      internalDate: "1752278400000",
      payload: {
        headers: [
          { name: "Subject", value: "=?UTF-8?B?5rWL6K+V?=" },
          { name: "From", value: "Alice <alice@example.com>" },
          { name: "To", value: "Bob <bob@example.com>" },
          { name: "Date", value: "Sat, 12 Jul 2026 10:00:00 +0800" }
        ],
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: toBase64Url("Hello from plain text")
            }
          },
          {
            mimeType: "text/html",
            body: {
              data: toBase64Url("<p>Hello from <strong>HTML</strong></p>")
            }
          }
        ]
      }
    },
    true
  );

  assert.equal(message.id, "msg-1");
  assert.equal(message.threadId, "thread-1");
  assert.equal(message.subject, "测试");
  assert.equal(message.from, "Alice <alice@example.com>");
  assert.equal(message.to, "Bob <bob@example.com>");
  assert.match(message.bodyText, /Hello from plain text/);
  assert.match(message.bodyHtml, /<strong>HTML<\/strong>/);
  assert.equal(message.internalDate, "2025-07-12T00:00:00.000Z");
});

test("buildGmailRawMessage builds multipart MIME messages", () => {
  const raw = buildGmailRawMessage({
    to: ["a@example.com", "b@example.com"],
    cc: "c@example.com",
    bcc: ["d@example.com"],
    subject: "周报",
    textBody: "Plain body",
    htmlBody: "<p>HTML body</p>",
    replyTo: "owner@example.com",
    inReplyTo: "<thread-message@example.com>",
    references: "<thread-message@example.com>"
  });

  assert.match(raw, /To: a@example\.com, b@example\.com/);
  assert.match(raw, /Cc: c@example\.com/);
  assert.match(raw, /Bcc: d@example\.com/);
  assert.match(raw, /Reply-To: owner@example\.com/);
  assert.match(raw, /In-Reply-To: <thread-message@example\.com>/);
  assert.match(raw, /References: <thread-message@example\.com>/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  assert.match(raw, /multipart\/alternative/);
  assert.match(raw, /Plain body/);
  assert.match(raw, /<p>HTML body<\/p>/);
});

test("buildGmailRawMessage rejects empty recipients or bodies", () => {
  assert.throws(
    () =>
      buildGmailRawMessage({
        to: [],
        textBody: "Hello"
      }),
    /At least one recipient/
  );

  assert.throws(
    () =>
      buildGmailRawMessage({
        to: ["a@example.com"]
      }),
    /Provide text_body or html_body/
  );
});
