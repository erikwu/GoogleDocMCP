import { toErrorResult } from "./errors.js";
import { readGoogleDoc, writeGoogleDoc } from "./google/docs.js";
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
