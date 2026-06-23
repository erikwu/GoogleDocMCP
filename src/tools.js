import { toErrorResult } from "./errors.js";
import { readGoogleDoc } from "./google/docs.js";
import { readGoogleSheet } from "./google/sheets.js";
import { syncGoogleDocSsotNote } from "./sync/googleDocSsot.js";
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
