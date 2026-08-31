# Google Workspace MCP

Chinese version: [README.md](README.md)

Documentation sync policy:
When updating the Chinese README in the future, update `README.en.md` at the same time so both documents stay aligned in structure and key information.

This repository is a minimal MCP project scaffold focused on establishing the following closed loop first:

1. Detect a Google Doc SSOT link from an Obsidian note
2. Read the Google Doc body through the Google Docs API
3. Write the synced content back into the note's managed sync block
4. Preserve the note's own manual content instead of overwriting it

## Currently Implemented

- `google_doc_read`
- `google_doc_write`
- `google_drive_authorize_root`
- `google_drive_list_folder`
- `google_drive_read_item`
- `google_gmail_read`
- `google_gmail_send`
- `google_sheet_read`
- `google_slide_read`
- `google_slide_write`
- `google_slide_apply_sheet_mappings`
- `obsidian_note_write`
- `obsidian_sync_google_doc`
- `obsidian_sync_google_doc_ssot`

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Authentication Modes

By default, this project supports local credential files for:

- `service_account`
- `access_token`

If you use `service_account`, you must share the target Google Doc / Google Sheet / Google Slide with the service account email.

If you want to access Gmail:

- in `access_token` mode, the token itself must include Gmail scopes
- in `service_account` mode, you will typically need Google Workspace domain-wide delegation and a configured `google.auth.delegatedUser`

## How To Get `google-service-account.json`

This project currently recommends `service_account` as the default authentication approach for the minimum viable loop, because it is the best fit for the workflow of "store a local credential file and let the MCP call the Google Docs API directly."

### 1. Prepare a Google Cloud Project

1. Open Google Cloud Console.
2. Create a new project, or select an existing one.
3. All APIs, service accounts, and keys used below will belong to that project.

### 2. Enable Google Docs API / Google Sheets API / Google Slides API / Gmail API / Google Drive API

1. Enable Google Docs API in the selected project.
2. If you want to use the already-supported Google Sheet reading capability, enable Google Sheets API as well.
3. If you want to use the already-supported Google Slide reading and writing capability, enable Google Slides API as well.
4. If you want to use Gmail reading or sending, enable Gmail API as well.
5. If you want to traverse Google Drive folders, enable Google Drive API as well.
6. If IAM-related pages are unavailable while creating keys, also verify that the IAM API is enabled.

### 3. Create a Service Account

1. Go to `IAM & Admin` -> `Service Accounts`.
2. Click `Create service account`.
3. Fill in:
   - `Service account name`
   - Optional `Description`
4. Click `Done`, or continue to assign project-level roles only if needed.

After creation, Google will assign an email to the service account. It typically looks like:

```text
your-service-account-name@your-project-id.iam.gserviceaccount.com
```

Later, you will need to share the target Google Doc / Google Sheet / Google Slide with that email address.

### 3.1 What Permissions Should I Choose During Service Account Creation?

In the Google Cloud creation wizard, the `Grant this service account access to project` step is optional. For the minimum viable loop in this project, the recommended choice is:

#### Recommended Choice

- `Grant this service account access to project`:
  select no role and continue
- `Service account users role field`:
  leave empty
- `Service account admins role field`:
  leave empty

#### Why This Is Recommended

At the moment, this MCP only needs to:

- read a specific Google Doc via the Google Docs API
- sync its content into an Obsidian note

For this kind of access, the better control model is:

- enable the Google Docs API in the project
- share the specific Google Doc with the service account email

That is usually better than giving the service account broad project-level IAM roles up front.

#### When You Actually Need Roles Here

You only need to grant project-level IAM roles in this step if you explicitly want the service account to access other Google Cloud resources in the same project, such as GCS, BigQuery, or Cloud Run.

For this project specifically:

- read-only access to Google Docs:
  no project role is needed here
- future write access to Google Docs:
  usually still no project role is needed here; what matters more is sharing the target Google Doc with the service account and changing the configured scope from read-only to editable

#### Permissions Required for You as the Operator

It helps to separate these two ideas:

- what permissions the service account itself has
- whether you personally have permission to create it and generate keys

If you are the person creating it, common prerequisite permissions listed by Google include:

- create a service account:
  `Create Service Accounts` / `roles/iam.serviceAccountCreator`
- assign project roles during creation:
  `Project IAM Admin` / `roles/resourcemanager.projectIamAdmin`
- create a service account key:
  `Service Account Key Admin` / `roles/iam.serviceAccountKeyAdmin`
- enable APIs:
  `Service Usage Admin` / `roles/serviceusage.serviceUsageAdmin`

If your organization blocks service account key creation by policy, you may still be able to create the service account but not see `Create new key`. In that case, an administrator needs to adjust the organization policy.

### 4. Generate and Download the JSON Key

1. Still on the `Service Accounts` page, click the service account you just created.
2. Open the `Keys` tab.
3. Click `Add key` -> `Create new key`.
4. Choose `JSON`.
5. Click `Create`.
6. Your browser will download a JSON file. This is the service account credential file used by this project.

It is recommended to rename the file to:

```text
google-service-account.json
```

Then place it under:

```text
secrets/google-service-account.json
```

That matches the default project configuration directly.

### 5. Configure the Project

Confirm that [config/local.json](config/local.json) contains the correct credential path:

```json
{
  "google": {
    "auth": {
      "mode": "service_account",
      "credentialPath": "../secrets/google-service-account.json"
    }
  }
}
```

If you store the file somewhere else, update `credentialPath` accordingly.

### 6. Share the Target Google Doc with the Service Account

This step is critical.

Because the MCP will access Google Docs as the service account, the service account must be granted access if it does not already own the document.

The process is the same as sharing a document with any other email address:

1. Open your Google Doc.
2. Click `Share` in the upper-right corner.
3. Add the service account email.
4. Grant at least `Viewer` access for read-only use. If you want `Obsidian -> Google Doc` overwrite sync, grant `Editor` access.

If you skip this step, the most common result is a `403 PERMISSION_DENIED` response from the API.

### 7. Security Notes

- The JSON key cannot be downloaded again later, so back it up immediately in a safe place.
- Do not commit `google-service-account.json` into git.
- Do not send the file through chat tools, email, or public cloud storage.
- If you suspect the key has leaked, delete the old key in Google Cloud Console and create a new one.

### 8. Common Issues

#### I Cannot See `Create new key`

This is usually caused by one of the following:

- you do not have enough Google Cloud permissions
- your organization policy blocks service account key creation
- you opened the list view instead of the specific service account detail page

First, make sure you can open the `Keys` tab for that specific service account. If key creation is blocked by policy, an administrator needs to allow it, or you need to switch to a different authentication approach later.

#### I Already Have a Key, but Reading Google Docs Still Returns `403`

Check these first:

- whether the target Google Doc has been shared with the service account email
- whether Google Docs API is enabled
- whether the key belongs to the same project you expect to use

#### I Get `404`

Check these first:

- whether the Google Doc URL is correct
- whether the document ID was parsed correctly
- whether the current service account really has access to the document

### 9. Official Documentation

- Create service accounts: https://cloud.google.com/iam/docs/service-accounts-create
- Create and delete service account keys: https://cloud.google.com/iam/docs/keys-create-delete
- Google Docs API quickstart: https://developers.google.com/workspace/docs/api/quickstart/nodejs

## Configuration

Edit [config/local.json](config/local.json) directly, or use [config/config.example.json](config/config.example.json) as a reference:

- Google credential path
- Obsidian vault root

The default credential path points to `secrets/google-service-account.json` in the repository root.

## How To Add `google_workspace` MCP to `~/.codex/config.toml`

If you want to use this project directly as a callable MCP inside Codex, register it in the global Codex config file at `~/.codex/config.toml`.

### 1. Open the Global Codex Config

Find this file:

```text
~/.codex/config.toml
```

If the file already exists, append a new `mcp_servers.google_workspace` block to it.

### 2. Add the Following Configuration

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.google_workspace]
command = "/opt/homebrew/bin/node"
args = ["/absolute/path/to/GoogleDoc MCP/src/index.js"]
startup_timeout_sec = 30.0
tool_timeout_sec = 120.0

[mcp_servers.google_workspace.env]
GOOGLE_WORKSPACE_MCP_CONFIG = "/absolute/path/to/GoogleDoc MCP/config/local.json"
```

### 3. Check the Paths for Your Machine

The `/absolute/path/to/GoogleDoc MCP` value above is only a placeholder.

Replace it with the real absolute path of this project on your machine, for example:

```text
/Users/erik/Documents/GoogleDoc MCP
```

Make sure the following paths are valid on your machine:

- `command` points to a working local Node executable
- `args` points to [src/index.js](src/index.js) in this project
- `GOOGLE_WORKSPACE_MCP_CONFIG` points to [config/local.json](config/local.json) in this project

If your Node executable is not located at `/opt/homebrew/bin/node`, run `which node` in your terminal and replace the path with the real one.

### 4. Make Sure `config/local.json` Is Ready

This MCP reads:

```text
/absolute/path/to/GoogleDoc MCP/config/local.json
```

At minimum, make sure it configures:

- Google authentication mode
- `credentialPath`
- `scopes`
- Obsidian vault root

If you use `service_account`, also make sure the JSON key file referenced by `credentialPath` is already in place.

If you want to read Google Sheets and write Google Docs / Google Slides, `scopes` should at least include:

```json
[
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/presentations"
]
```

### 5. Restart Codex

After updating `~/.codex/config.toml`, it is best to restart the Codex app.

This is the most reliable approach because newly added MCP servers usually need a full Codex restart before they are fully loaded.

### 6. Verify the Integration

After restart, try calling the tools exposed by this MCP from Codex, for example:

- `google_doc_read`
- `google_doc_write`
- `google_gmail_read`
- `google_gmail_send`
- `google_sheet_read`
- `google_slide_read`
- `google_slide_write`
- `google_slide_apply_sheet_mappings`
- `obsidian_note_write`
- `obsidian_sync_google_doc`
- `obsidian_sync_google_doc_ssot`

If those tools are recognized, the `google_workspace` MCP has been integrated successfully.

### 8. Local-Only Files in This Repository

The following files or directories are ignored by default and will not be committed to git:

- `secrets/`
- `config/local.json`
- `.codex/`
- `.learnings/`

This prevents the service account key, local debug configuration, and private runtime traces from being pushed to the remote repository.

### 7. Common Issues

#### I Updated the Config, but Codex Still Cannot See the Tools

Check these first:

- whether the TOML syntax in `~/.codex/config.toml` is valid
- whether the `command` path really exists
- whether the `args` path to `src/index.js` is correct
- whether the file referenced by `GOOGLE_WORKSPACE_MCP_CONFIG` actually exists
- whether Codex has been fully closed and reopened

#### The MCP Starts, but Google API Calls Still Fail

Check these first:

- whether `credentialPath` is correct
- whether the service account key is valid
- whether the target Google Doc has already been shared with the service account email
- whether Google Docs API / Sheets API / Slides API have been enabled in the intended GCP project

## Google Sheet Reading

`google_sheet_read` supports these minimum input forms:

- provide a Google Sheet URL directly
- provide a spreadsheet ID
- combine with `sheet` to specify a tab name
- combine with `gid` to specify a tab ID
- combine with `range` to specify an A1 range

Example:

```json
{
  "source": {
    "url": "https://docs.google.com/spreadsheets/d/your-sheet-id/edit#gid=0"
  }
}
```

```json
{
  "source": {
    "id": "your-sheet-id",
    "sheet": "Sheet1",
    "range": "A1:F20"
  }
}
```

The returned payload includes:

- `title`
- `sheetTitle`
- `sheetId`
- `requestedRange`
- `markdown`
- `plainText`
- `rows`
- `availableSheets`

## Google Doc Reading And Writing

`google_doc_read` returns:

- `title`
- `markdown`
- `plainText`
- `tabs`

`google_doc_write` overwrites the Google Doc body from markdown or plain text.

The current writer preserves these structures first:

- Markdown headings
- normal paragraphs
- unordered lists
- ordered lists
- blockquotes
- code blocks
- bold, italic, and strikethrough
- inline code
- Markdown links
- Markdown tables downgraded into readable text rows

The current writer does not yet preserve complex fidelity for:

- Google Doc tabs
- more complex nested markdown style combinations
- real Google Doc table reconstruction

Example:

```json
{
  "source": {
    "url": "https://docs.google.com/document/d/your-doc-id/edit"
  },
  "markdown": "# Weekly Update\n\n- Item A\n- Item B"
}
```

## Google Slide Reading And Writing

`google_slide_read` returns:

- presentation title
- `revisionId`
- each slide's `slideNumber`
- each slide's `objectId`
- normalized slide `markdown`
- structured page-element metadata for each slide

`google_slide_write` currently supports three minimum operation types:

- `replace_all_text`
  best for placeholder-style text replacement, optionally scoped to a specific slide
- `replace_shape_text`
  best for replacing the full content of one specific text shape by `object_id`
- `replace_table_cell_text`
  best for replacing one specific table cell by the table `object_id`; `row_index` and `column_index` are 0-based

Example:

```json
{
  "source": {
    "url": "https://docs.google.com/presentation/d/your-slide-id/edit"
  }
}
```

```json
{
  "source": {
    "id": "your-slide-id"
  },
  "operations": [
    {
      "mode": "replace_all_text",
      "match_text": "{{owner}}",
      "replace_text": "Erik",
      "slide_number": 2
    },
    {
      "mode": "replace_shape_text",
      "object_id": "g2b7c9d1e0f_0_12",
      "text": "Updated content from MCP"
    },
    {
      "mode": "replace_table_cell_text",
      "object_id": "g3f23f6f4d08_0_3",
      "row_index": 1,
      "column_index": 3,
      "text": "4/22"
    }
  ]
}
```

## Google Sheet Driven Google Slide Updates

`google_slide_apply_sheet_mappings` first reads a Google Sheet, then applies the mapping rows to a Google Slide presentation.

Recommended minimum header row:

```text
mode | placeholder | value | slide | object_id | text | enabled
```

How it works:

- `mode = replace_all_text`
  requires `placeholder` and `value`
- `mode = replace_shape_text`
  requires `object_id` and `text`
- `slide`
  can be a slide number such as `2`, or a slide `objectId`
- `enabled`
  can be `true/false`

Example:

```json
{
  "presentation": {
    "url": "https://docs.google.com/presentation/d/your-slide-id/edit"
  },
  "sheet": {
    "url": "https://docs.google.com/spreadsheets/d/your-sheet-id/edit#gid=0",
    "sheet": "Mappings",
    "range": "A1:G20"
  }
}
```

This tool is useful for two common patterns:

- manage placeholder replacement for Slides from a Sheet
- use a Sheet to define the final content for specific text shapes by `object_id`

## Google Drive Folder Listing

`google_drive_authorize_root` is the explicit step for authorizing a Drive root folder for the current working session.

It will:

- verify that the current Google account can actually access the folder
- require an explicit confirmation
- return a `grant_id`

All subsequent Drive traversal must include that `grant_id`, so the MCP is restricted to that authorized subtree.

`google_drive_list_folder` supports:

- listing folder contents inside an already authorized subtree by `grant_id`
- optionally passing a `folder_id`, as long as that folder already belongs to the authorized subtree
- optional recursive traversal

`google_drive_read_item` supports:

- reading a previously discovered Google file by `grant_id + item_id`
- Google Doc / Google Sheet / Google Slide items are currently supported
- for Sheets, you can still pass `sheet` / `gid` / `range`

This means that in Drive-scoped mode, the agent does not need arbitrary raw Doc / Sheet / Slide ids up front.
It can authorize a root, discover items beneath it, then read only those discovered items.

The response includes:

- root folder metadata
- child item `id`
- `name`
- `mimeType`
- whether the item is a folder
- a directly openable `webViewLink`
- hierarchy `depth`
- logical `path`

Example:

```json
{
  "source": {
    "url": "https://drive.google.com/drive/folders/1UWjRbSk0s1ZmzcUfN6zNvk1Fnb9PNbC9"
  },
  "ttl_hours": 8
}
```

```json
{
  "grant_id": "gdrv_xxxxxxxx",
  "recursive": true,
  "max_depth": 3
}
```

```json
{
  "grant_id": "gdrv_xxxxxxxx",
  "item_id": "1AbCdEfGhIjKlMnOp"
}
```

## Gmail Reading And Sending

`google_gmail_read` supports two common patterns:

- read a message list by Gmail search syntax such as `from:foo@example.com newer_than:7d`
- read a single message directly by `message_id`

The response includes:

- sender, recipients, cc, subject, and date
- Gmail `labelIds`
- `snippet`
- normalized `bodyText`
- `bodyHtml` when an HTML body is available

`google_gmail_send` supports plain text or HTML email, plus:

- `cc`
- `bcc`
- `reply_to`
- `thread_id`
- `in_reply_to`
- `references`

Send safety rule:

- every non-`dry_run` call to `google_gmail_send` requires a second confirmation
- the Gmail API send only happens after that confirmation is accepted

Example:

```json
{
  "query": "from:alice@example.com newer_than:3d",
  "max_results": 5,
  "include_body": true
}
```

```json
{
  "to": ["bob@example.com"],
  "subject": "Weekly update",
  "text_body": "Hi Bob,\n\nThis is a test email from Google Workspace MCP.",
  "dry_run": true
}
```

## Start

```bash
node src/index.js
```

## Two Sync Templates

### Template 1: Obsidian Markdown Is Primary, Google Doc Is Secondary

When you call `obsidian_sync_google_doc`, the MCP reads the markdown content inside the managed marker block and overwrites the Google Doc body with it.

See:

- [examples/obsidian-primary-sync.example.md](/Users/erik/Documents/GoogleDoc%20MCP/examples/obsidian-primary-sync.example.md)

Template:

```md
---
google_doc_sync_url: https://docs.google.com/document/d/your-doc-id/edit
google_doc_sync_direction: obsidian_to_google_doc
google_doc_sync_heading: "## Obsidian Primary Sync"
google_doc_sync_start_marker: "<!-- google-doc-sync:start -->"
google_doc_sync_end_marker: "<!-- google-doc-sync:end -->"
---

# My Notes

This part belongs to Obsidian only and is not synced.

## Obsidian Primary Sync

<!-- google-doc-sync:start -->
# This block is owned by Obsidian

This content overwrites the Google Doc body.
<!-- google-doc-sync:end -->
```

### Template 2: Google Doc Is Primary, Obsidian Markdown Is Secondary

When you call `obsidian_sync_google_doc`, the MCP reads the latest Google Doc content and updates only the managed block inside the note, preserving all manual note content outside that block.

See:

- [examples/google-doc-primary-sync.example.md](/Users/erik/Documents/GoogleDoc%20MCP/examples/google-doc-primary-sync.example.md)

Template:

```md
---
google_doc_sync_url: https://docs.google.com/document/d/your-doc-id/edit
google_doc_sync_direction: google_doc_to_obsidian
google_doc_sync_heading: "## Google Doc Primary Sync"
google_doc_sync_start_marker: "<!-- google-doc-sync:start -->"
google_doc_sync_end_marker: "<!-- google-doc-sync:end -->"
---

# My Notes

This part belongs to Obsidian and will not be overwritten.

## Google Doc Primary Sync

<!-- google-doc-sync:start -->
<!-- google-doc-sync:end -->
```

### Template 3: Compare Only, Modify Neither Side

When you call `obsidian_sync_google_doc` with `compare_only`, the MCP reads both the Google Doc and the managed Obsidian marker block, returns a difference summary, and does not modify either the Google Doc or the Obsidian note.

See:

- [examples/compare-only-sync.example.md](/Users/erik/Documents/GoogleDoc%20MCP/examples/compare-only-sync.example.md)

Template:

```md
---
google_doc_sync_url: https://docs.google.com/document/d/your-doc-id/edit
google_doc_sync_direction: compare_only
google_doc_sync_heading: "## Compare Only Sync"
google_doc_sync_start_marker: "<!-- google-doc-sync:start -->"
google_doc_sync_end_marker: "<!-- google-doc-sync:end -->"
---

# My Notes

This part belongs to Obsidian only and is not written back anywhere.

## Compare Only Sync

<!-- google-doc-sync:start -->
# Current Obsidian block

This mode only compares differences and does not overwrite either side.
<!-- google-doc-sync:end -->
```

The result includes:

- `comparison.exactMatch`: whether both sides are exactly the same
- `comparison.comparisonStatus`: `match`, `different`, or `managed-block-missing`
- `comparison.hunks`: preview segments of the detected differences
- `modifiedTargets: []`: an explicit signal that nothing was changed

### How To Call It

Recommended minimum input:

```json
{
  "note_path": "/absolute/path/to/your-note.md"
}
```

The tool will read these template fields from the note frontmatter automatically:

- `google_doc_sync_url`
- `google_doc_sync_direction`
- `google_doc_sync_start_marker`
- `google_doc_sync_end_marker`
- `google_doc_sync_heading`

If you want to temporarily override the direction, you can also pass it explicitly:

```json
{
  "note_path": "/absolute/path/to/your-note.md",
  "direction": "obsidian_to_google_doc"
}
```

You can also call compare mode explicitly:

```json
{
  "note_path": "/absolute/path/to/your-note.md",
  "direction": "compare_only"
}
```

## Legacy SSOT Template

```md
---
google_doc_ssot_url: https://docs.google.com/document/d/your-doc-id/edit
---

# My Notes

This content is maintained manually and will not be overwritten during sync.

## Google Doc SSOT Sync

<!-- google-doc-ssot:start -->
<!-- google-doc-ssot:end -->
```

## Sync Behavior

`obsidian_sync_google_doc_ssot` is now a backward-compatible alias:

- if the note does not configure a direction, it defaults to `Google Doc -> Obsidian`
- if the note explicitly sets `google_doc_sync_direction: obsidian_to_google_doc`, it now respects that direction instead of forcing `Google Doc -> Obsidian`

- all other note content stays unchanged
- if the sync block does not exist, it will be appended to the end of the note automatically
- if the update only appends new content from the tail of the source Doc, the result will be marked as `append-only`

`obsidian_sync_google_doc` is the newer and more general entry point:

- when `google_doc_sync_direction = google_doc_to_obsidian`, it behaves like the legacy `obsidian_sync_google_doc_ssot`
- when `google_doc_sync_direction = obsidian_to_google_doc`, it overwrites the Google Doc with the managed note block
- when `google_doc_sync_direction = compare_only`, it only returns a difference summary between the Google Doc and the managed Obsidian block without modifying either side

The current MCP does not run a background watcher.

- “sync immediately after edits” means the sync happens immediately when you call the MCP tool
- it does not auto-trigger in the background the instant you type inside Obsidian or Google Docs
