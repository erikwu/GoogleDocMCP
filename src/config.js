import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG_RELATIVE_PATH = path.join("config", "local.json");

function resolveFrom(baseDir, targetPath) {
  if (!targetPath) {
    return targetPath;
  }

  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  return path.resolve(baseDir, targetPath);
}

function detectDefaultVaultRoot() {
  const candidate = process.env.OBSIDIAN_VAULT_ROOT;
  if (!candidate) {
    return null;
  }

  return fs.existsSync(candidate) ? candidate : null;
}

function mergeConfig(rawConfig, configDir) {
  const defaultVaultRoot = detectDefaultVaultRoot();

  return {
    google: {
      auth: {
        mode: rawConfig?.google?.auth?.mode ?? "service_account",
        credentialPath: resolveFrom(
          configDir,
          rawConfig?.google?.auth?.credentialPath
        ),
        scopes:
          rawConfig?.google?.auth?.scopes ??
          [
            "https://www.googleapis.com/auth/documents",
            "https://www.googleapis.com/auth/spreadsheets.readonly",
            "https://www.googleapis.com/auth/presentations"
          ]
      }
    },
    obsidian: {
      vaultRoot: resolveFrom(
        configDir,
        rawConfig?.obsidian?.vaultRoot ?? defaultVaultRoot
      )
    },
    sync: {
      blockHeading:
        rawConfig?.sync?.blockHeading ?? "## Google Doc SSOT Sync",
      startMarker:
        rawConfig?.sync?.startMarker ?? "<!-- google-doc-ssot:start -->",
      endMarker: rawConfig?.sync?.endMarker ?? "<!-- google-doc-ssot:end -->"
    },
    limits: {
      maxDocChars: rawConfig?.limits?.maxDocChars ?? 120000
    }
  };
}

let cachedConfig = null;

export function getConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath =
    process.env.GOOGLE_WORKSPACE_MCP_CONFIG ??
    path.resolve(process.cwd(), DEFAULT_CONFIG_RELATIVE_PATH);

  if (!fs.existsSync(configPath)) {
    cachedConfig = mergeConfig({}, process.cwd());
    return cachedConfig;
  }

  const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  cachedConfig = mergeConfig(rawConfig, path.dirname(configPath));
  return cachedConfig;
}
