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
- `google_sheet_read`
- `obsidian_note_write`
- `obsidian_sync_google_doc_ssot`

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Authentication Modes

By default, this project supports local credential files for:

- `service_account`
- `access_token`

If you use `service_account`, you must share the target Google Doc / Google Sheet with the service account email.

## How To Get `google-service-account.json`

This project currently recommends `service_account` as the default authentication approach for the minimum viable loop, because it is the best fit for the workflow of "store a local credential file and let the MCP call the Google Docs API directly."

### 1. Prepare a Google Cloud Project

1. Open Google Cloud Console.
2. Create a new project, or select an existing one.
3. All APIs, service accounts, and keys used below will belong to that project.

### 2. Enable Google Docs API / Google Sheets API

1. Enable Google Docs API in the selected project.
2. If you want to use the already-supported Google Sheet reading capability, enable Google Sheets API as well.
3. If you plan to add Google Slides support later, it is a good idea to enable Google Slides API at the same time.
4. If IAM-related pages are unavailable while creating keys, also verify that the IAM API is enabled.

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

Later, you will need to share the target Google Doc with that email address.

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
4. Grant at least `Viewer` access. If you later want write-back support, grant a higher permission level.

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

If you want to read Google Sheets, `scopes` should at least include:

```json
[
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly"
]
```

### 5. Restart Codex

After updating `~/.codex/config.toml`, it is best to restart the Codex app.

This is the most reliable approach because newly added MCP servers usually need a full Codex restart before they are fully loaded.

### 6. Verify the Integration

After restart, try calling the tools exposed by this MCP from Codex, for example:

- `google_doc_read`
- `google_sheet_read`
- `obsidian_note_write`
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

## Start

```bash
node src/index.js
```

## Recommended Obsidian Note Format

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

`obsidian_sync_google_doc_ssot` only updates the content between `<!-- google-doc-ssot:start -->` and `<!-- google-doc-ssot:end -->`.

- all other note content stays unchanged
- if the sync block does not exist, it will be appended to the end of the note automatically
- if the update only appends new content from the tail of the source Doc, the result will be marked as `append-only`
