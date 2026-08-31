import { toErrorResult } from "./errors.js";
import {
  authorizeGoogleDriveRoot,
  listGoogleDriveFolder,
  readGoogleDriveGrantedItem
} from "./google/drive.js";
import { readGoogleDoc, writeGoogleDoc } from "./google/docs.js";
import { readGoogleGmail, sendGoogleGmail } from "./google/gmail.js";
import { readGoogleSheet } from "./google/sheets.js";
import {
  applyGoogleSheetMappingsToSlide,
  readGoogleSlide,
  writeGoogleSlide
} from "./google/slides.js";
import {
  syncGoogleDocSsotNote,
  syncGoogleDocTemplateNote
} from "./sync/googleDocSsot.js";
import { writeNote } from "./obsidian/notes.js";

export async function runGoogleDocRead(args) {
  try {
    const doc = await readGoogleDoc(args.source);
    return {
      ok: true,
      data: doc
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function runGoogleDocWrite(args) {
  try {
    const result = await writeGoogleDoc({
      source: args.source,
      markdown: args.markdown ?? args.text ?? "",
      dryRun: args.dry_run
    });

    return {
      ok: true,
      data: result
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function runGoogleDriveAuthorizeRoot(args, context = {}) {
  try {
    const grant = await authorizeGoogleDriveRoot(
      {
        source: args.source,
        ttlHours: args.ttl_hours
      },
      context
    );

    return {
      ok: true,
      data: grant
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function runGoogleDriveListFolder(args) {
  try {
    const folder = await listGoogleDriveFolder({
      grantId: args.grant_id,
      folderId: args.folder_id,
      recursive: args.recursive,
      maxDepth: args.max_depth,
      pageSize: args.page_size,
      pageToken: args.page_token
    });

    return {
      ok: true,
      data: folder
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function runGoogleDriveReadItem(args) {
  try {
    const item = await readGoogleDriveGrantedItem({
      grantId: args.grant_id,
      itemId: args.item_id,
      sheet: args.sheet,
      gid: args.gid,
      range: args.range
    });

    return {
      ok: true,
      data: item
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function runGoogleSheetRead(args) {
  try {
    const sheet = await readGoogleSheet(args.source);
    return {
      ok: true,
      data: sheet
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function runGoogleGmailRead(args) {
  try {
    const mailbox = await readGoogleGmail({
      query: args.query,
      maxResults: args.max_results,
      labelIds: args.label_ids,
      pageToken: args.page_token,
      includeBody: args.include_body,
      messageId: args.message_id
    });
    return {
      ok: true,
      data: mailbox
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function runGoogleGmailSend(args, context = {}) {
  try {
    const result = await sendGoogleGmail(
      {
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        subject: args.subject,
        textBody: args.text_body,
        htmlBody: args.html_body,
        threadId: args.thread_id,
        replyTo: args.reply_to,
        inReplyTo: args.in_reply_to,
        references: args.references,
        dryRun: args.dry_run
      },
      context
    );

    return {
      ok: true,
      data: result
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function runGoogleSlideRead(args) {
  try {
    const slide = await readGoogleSlide(args.source);
    return {
      ok: true,
      data: slide
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function runGoogleSlideWrite(args) {
  try {
    const result = await writeGoogleSlide({
      source: args.source,
      operations: args.operations,
      writeControl: args.write_control,
      dryRun: args.dry_run
    });

    return {
      ok: true,
      data: result
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function runGoogleSlideApplySheetMappings(args) {
  try {
    const result = await applyGoogleSheetMappingsToSlide({
      presentation: args.presentation,
      sheet: args.sheet,
      mapping: args.mapping,
      writeControl: args.write_control,
      dryRun: args.dry_run
    });

    return {
      ok: true,
      data: result
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function runObsidianNoteWrite(args) {
  try {
    const result = writeNote({
      notePath: args.note_path,
      body: args.body,
      mode: args.mode,
      startMarker: args.start_marker,
      endMarker: args.end_marker,
      heading: args.heading
    });

    return {
      ok: true,
      data: result
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function runObsidianSyncGoogleDocSsot(args) {
  try {
    const result = await syncGoogleDocSsotNote({
      notePath: args.note_path,
      source: args.source
    });

    return {
      ok: true,
      data: result
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function runObsidianSyncGoogleDoc(args) {
  try {
    const result = await syncGoogleDocTemplateNote({
      notePath: args.note_path,
      source: args.source,
      direction: args.direction
    });

    return {
      ok: true,
      data: result
    };
  } catch (error) {
    return toErrorResult(error);
  }
}
