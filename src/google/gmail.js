import crypto from "node:crypto";
import { getConfig } from "../config.js";
import { AppError } from "../errors.js";
import { googleAuthProvider } from "./auth.js";

const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const DEFAULT_MAX_RESULTS = 10;
const MAX_ALLOWED_RESULTS = 20;

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, maxChars)}\n\n[truncated]`,
    truncated: true
  };
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [value];
}

function normalizeAddressList(value) {
  return toArray(value)
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function decodeBase64Url(input) {
  const normalized = String(input ?? "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded =
    padding === 0 ? normalized : `${normalized}${"=".repeat(4 - padding)}`;

  return Buffer.from(padded, "base64").toString("utf8");
}

function stripHtml(html) {
  return String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeMimeWord(match, charset, encoding, value) {
  const normalizedEncoding = String(encoding).toUpperCase();
  const buffer =
    normalizedEncoding === "B"
      ? Buffer.from(value, "base64")
      : Buffer.from(
          value.replace(/_/g, " ").replace(/=([A-Fa-f0-9]{2})/g, (_, hex) =>
            String.fromCharCode(Number.parseInt(hex, 16))
          ),
          "binary"
        );

  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

function decodeMimeHeader(value) {
  return String(value ?? "").replace(
    /=\?([^?]+)\?([BbQq])\?([^?]+)\?=/g,
    decodeMimeWord
  );
}

function findHeader(headers, name) {
  const matched = (headers ?? []).find(
    (header) => String(header?.name ?? "").toLowerCase() === name.toLowerCase()
  );

  return matched?.value ? decodeMimeHeader(matched.value) : null;
}

function collectBodyParts(part, bucket) {
  if (!part) {
    return;
  }

  if (part.body?.data && part.mimeType === "text/plain") {
    bucket.text.push(decodeBase64Url(part.body.data));
  }

  if (part.body?.data && part.mimeType === "text/html") {
    bucket.html.push(decodeBase64Url(part.body.data));
  }

  for (const child of part.parts ?? []) {
    collectBodyParts(child, bucket);
  }
}

function extractMessageBodies(payload) {
  const bucket = {
    text: [],
    html: []
  };

  collectBodyParts(payload, bucket);

  if (
    bucket.text.length === 0 &&
    bucket.html.length === 0 &&
    payload?.body?.data
  ) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/html") {
      bucket.html.push(decoded);
    } else {
      bucket.text.push(decoded);
    }
  }

  return {
    text: bucket.text.join("\n\n").trim(),
    html: bucket.html.join("\n\n").trim()
  };
}

export function normalizeMessagePayload(messagePayload, includeBody) {
  const config = getConfig();
  const headers = messagePayload?.payload?.headers ?? [];
  const bodies = includeBody
    ? extractMessageBodies(messagePayload?.payload)
    : { text: "", html: "" };
  const textFallback =
    bodies.text || (bodies.html ? stripHtml(bodies.html) : messagePayload?.snippet ?? "");
  const truncatedText = truncateText(textFallback, config.limits.maxDocChars);
  const truncatedHtml = truncateText(bodies.html, config.limits.maxDocChars);

  return {
    id: messagePayload?.id ?? null,
    threadId: messagePayload?.threadId ?? null,
    labelIds: Array.isArray(messagePayload?.labelIds) ? messagePayload.labelIds : [],
    snippet: messagePayload?.snippet ?? "",
    historyId: messagePayload?.historyId ?? null,
    internalDate: messagePayload?.internalDate
      ? new Date(Number(messagePayload.internalDate)).toISOString()
      : null,
    subject: findHeader(headers, "Subject"),
    from: findHeader(headers, "From"),
    to: findHeader(headers, "To"),
    cc: findHeader(headers, "Cc"),
    bcc: findHeader(headers, "Bcc"),
    replyTo: findHeader(headers, "Reply-To"),
    date: findHeader(headers, "Date"),
    bodyText: includeBody ? truncatedText.text : null,
    bodyHtml: includeBody && bodies.html ? truncatedHtml.text : null,
    truncated:
      includeBody &&
      (truncatedText.truncated ||
        (Boolean(bodies.html) && truncatedHtml.truncated))
  };
}

async function gmailRequest(pathname, accessToken, init = {}) {
  const response = await fetch(`https://gmail.googleapis.com${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body
        ? {
            "Content-Type": "application/json"
          }
        : {}),
      ...(init.headers ?? {})
    }
  });

  if (response.status === 404) {
    throw new AppError("NOT_FOUND", "Gmail message was not found.");
  }

  if (response.status === 403) {
    throw new AppError(
      "PERMISSION_DENIED",
      "Gmail API denied access to this mailbox."
    );
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new AppError("UPSTREAM_ERROR", "Gmail API request failed.", {
      retryable: response.status >= 500,
      details: {
        status: response.status,
        responseText
      }
    });
  }

  return response.json();
}

async function fetchMessageList(
  { query, maxResults, labelIds, pageToken },
  accessToken
) {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  if (query) {
    url.searchParams.set("q", query);
  }
  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }
  url.searchParams.set(
    "maxResults",
    String(Math.min(Math.max(maxResults, 1), MAX_ALLOWED_RESULTS))
  );
  for (const labelId of labelIds) {
    url.searchParams.append("labelIds", labelId);
  }

  return gmailRequest(url.pathname + url.search, accessToken);
}

async function fetchMessage(messageId, accessToken, includeBody) {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
      messageId
    )}`
  );
  url.searchParams.set("format", includeBody ? "full" : "metadata");
  if (!includeBody) {
    for (const header of [
      "Subject",
      "From",
      "To",
      "Cc",
      "Bcc",
      "Reply-To",
      "Date"
    ]) {
      url.searchParams.append("metadataHeaders", header);
    }
  }

  return gmailRequest(url.pathname + url.search, accessToken);
}

function encodeMimeHeader(value) {
  const normalized = String(value ?? "");
  return /[^\x20-\x7E]/.test(normalized)
    ? `=?UTF-8?B?${Buffer.from(normalized, "utf8").toString("base64")}?=`
    : normalized;
}

function encodeBase64Url(input) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildMultipartBody(textBody, htmlBody, boundary) {
  const chunks = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    textBody,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "",
    htmlBody,
    `--${boundary}--`,
    ""
  ];

  return chunks.join("\r\n");
}

export function buildGmailRawMessage({
  to,
  cc,
  bcc,
  subject,
  textBody,
  htmlBody,
  replyTo,
  inReplyTo,
  references
}) {
  const toList = normalizeAddressList(to);
  const ccList = normalizeAddressList(cc);
  const bccList = normalizeAddressList(bcc);
  const normalizedSubject = normalizeOptionalString(subject) ?? "";
  const normalizedTextBody = String(textBody ?? "").trim();
  const normalizedHtmlBody = String(htmlBody ?? "").trim();

  if (toList.length === 0) {
    throw new AppError("INVALID_INPUT", "At least one recipient is required.");
  }

  if (!normalizedTextBody && !normalizedHtmlBody) {
    throw new AppError(
      "INVALID_INPUT",
      "Provide text_body or html_body before sending email."
    );
  }

  const headers = [
    "MIME-Version: 1.0",
    `To: ${toList.join(", ")}`,
    `Subject: ${encodeMimeHeader(normalizedSubject)}`
  ];

  if (ccList.length > 0) {
    headers.push(`Cc: ${ccList.join(", ")}`);
  }

  if (bccList.length > 0) {
    headers.push(`Bcc: ${bccList.join(", ")}`);
  }

  if (replyTo) {
    headers.push(`Reply-To: ${replyTo}`);
  }

  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
  }

  if (references) {
    headers.push(`References: ${references}`);
  }

  let body = "";
  if (normalizedTextBody && normalizedHtmlBody) {
    const boundary = `gmail-mcp-${crypto.randomUUID()}`;
    headers.push(
      `Content-Type: multipart/alternative; boundary="${boundary}"`
    );
    body = buildMultipartBody(normalizedTextBody, normalizedHtmlBody, boundary);
  } else if (normalizedHtmlBody) {
    headers.push('Content-Type: text/html; charset="UTF-8"');
    body = `${normalizedHtmlBody}\r\n`;
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    body = `${normalizedTextBody}\r\n`;
  }

  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

function buildSendConfirmationSummary({
  to,
  cc,
  bcc,
  subject,
  textBody,
  htmlBody
}) {
  const previewSource = textBody || stripHtml(htmlBody || "");
  const preview = truncateText(previewSource, 500).text;

  return {
    to: normalizeAddressList(to),
    cc: normalizeAddressList(cc),
    bccCount: normalizeAddressList(bcc).length,
    subject: normalizeOptionalString(subject) ?? "",
    preview
  };
}

export async function readGoogleGmail({
  query,
  maxResults = DEFAULT_MAX_RESULTS,
  labelIds,
  pageToken,
  includeBody = true,
  messageId
}) {
  const normalizedLabelIds = normalizeAddressList(labelIds);
  const accessToken = await googleAuthProvider.getAccessToken(
    [GMAIL_READ_SCOPE],
    { requireDelegatedUser: true }
  );

  if (messageId) {
    const message = await fetchMessage(
      messageId,
      accessToken,
      Boolean(includeBody)
    );

    return {
      mailbox: "me",
      fetchedAt: new Date().toISOString(),
      messageCount: 1,
      nextPageToken: null,
      messages: [normalizeMessagePayload(message, Boolean(includeBody))]
    };
  }

  const listPayload = await fetchMessageList(
    {
      query: normalizeOptionalString(query),
      maxResults: Number(maxResults) || DEFAULT_MAX_RESULTS,
      labelIds: normalizedLabelIds,
      pageToken: normalizeOptionalString(pageToken)
    },
    accessToken
  );
  const messages = await Promise.all(
    (listPayload.messages ?? []).map((message) =>
      fetchMessage(message.id, accessToken, Boolean(includeBody))
    )
  );

  return {
    mailbox: "me",
    fetchedAt: new Date().toISOString(),
    query: normalizeOptionalString(query),
    labelIds: normalizedLabelIds,
    messageCount: messages.length,
    nextPageToken: listPayload.nextPageToken ?? null,
    resultSizeEstimate: listPayload.resultSizeEstimate ?? messages.length,
    messages: messages.map((message) =>
      normalizeMessagePayload(message, Boolean(includeBody))
    )
  };
}

export async function sendGoogleGmail(
  {
    to,
    cc,
    bcc,
    subject,
    textBody,
    htmlBody,
    threadId,
    replyTo,
    inReplyTo,
    references,
    dryRun = false
  },
  { confirmBeforeSend } = {}
) {
  const summary = buildSendConfirmationSummary({
    to,
    cc,
    bcc,
    subject,
    textBody,
    htmlBody
  });
  const raw = buildGmailRawMessage({
    to,
    cc,
    bcc,
    subject,
    textBody,
    htmlBody,
    replyTo,
    inReplyTo,
    references
  });

  if (dryRun) {
    return {
      sent: false,
      cancelled: false,
      dryRun: true,
      confirmedByUser: false,
      ...summary,
      threadId: normalizeOptionalString(threadId),
      rawSize: raw.length
    };
  }

  if (typeof confirmBeforeSend !== "function") {
    throw new AppError(
      "CONFIRMATION_REQUIRED",
      "gmail_send_email requires an interactive user confirmation step."
    );
  }

  const confirmed = await confirmBeforeSend(summary);
  if (!confirmed) {
    return {
      sent: false,
      cancelled: true,
      dryRun: false,
      confirmedByUser: false,
      ...summary,
      threadId: normalizeOptionalString(threadId)
    };
  }

  const accessToken = await googleAuthProvider.getAccessToken(
    [GMAIL_SEND_SCOPE],
    { requireDelegatedUser: true }
  );
  const sendPayload = await gmailRequest(
    "/gmail/v1/users/me/messages/send",
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        raw: encodeBase64Url(raw),
        ...(threadId
          ? {
              threadId
            }
          : {})
      })
    }
  );

  return {
    sent: true,
    cancelled: false,
    dryRun: false,
    confirmedByUser: true,
    ...summary,
    id: sendPayload?.id ?? null,
    threadId: sendPayload?.threadId ?? normalizeOptionalString(threadId),
    labelIds: Array.isArray(sendPayload?.labelIds) ? sendPayload.labelIds : []
  };
}
