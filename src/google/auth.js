import crypto from "node:crypto";
import fs from "node:fs";
import { getConfig } from "../config.js";
import { AppError } from "../errors.js";

function readCredentialFile(credentialPath) {
  if (!credentialPath) {
    throw new AppError(
      "AUTH_REQUIRED",
      "No Google credential file is configured."
    );
  }

  if (!fs.existsSync(credentialPath)) {
    throw new AppError(
      "AUTH_REQUIRED",
      "Google credential file was not found.",
      { details: { credentialPath } }
    );
  }

  return JSON.parse(fs.readFileSync(credentialPath, "utf8"));
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signJwt(header, payload, privateKey) {
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();

  const signature = signer.sign(privateKey);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

class GoogleAuthProvider {
  constructor() {
    this.cachedTokens = new Map();
  }

  async getAccessToken(scopes, options = {}) {
    const config = getConfig();
    const authConfig = config.google.auth;
    const requestedScopes = this.normalizeScopes(scopes ?? authConfig.scopes);

    if (authConfig.mode === "service_account") {
      return this.getServiceAccountAccessToken(
        authConfig,
        requestedScopes,
        options
      );
    }

    if (authConfig.mode === "access_token") {
      return this.getStaticAccessToken(authConfig);
    }

    throw new AppError("AUTH_REQUIRED", "Unsupported Google auth mode.", {
      details: { mode: authConfig.mode }
    });
  }

  normalizeScopes(scopes) {
    const values = Array.isArray(scopes) ? scopes : [];
    const normalized = [...new Set(values.map((scope) => String(scope).trim()))]
      .filter(Boolean)
      .sort();

    if (normalized.length === 0) {
      throw new AppError(
        "AUTH_REQUIRED",
        "At least one Google OAuth scope must be configured."
      );
    }

    return normalized;
  }

  getStaticAccessToken(authConfig) {
    const credential = readCredentialFile(authConfig.credentialPath);

    if (typeof credential === "string") {
      return credential;
    }

    if (typeof credential?.access_token === "string") {
      return credential.access_token;
    }

    throw new AppError(
      "AUTH_REQUIRED",
      "The access token credential file must contain access_token."
    );
  }

  resolveDelegatedUser(authConfig, options) {
    if (options.delegatedUser) {
      return String(options.delegatedUser).trim();
    }

    if (options.requireDelegatedUser) {
      const delegatedUser = String(authConfig.delegatedUser ?? "").trim();
      if (!delegatedUser) {
        throw new AppError(
          "AUTH_REQUIRED",
          "Gmail access with service_account mode requires google.auth.delegatedUser.",
          {
            details: {
              authMode: authConfig.mode
            }
          }
        );
      }

      return delegatedUser;
    }

    return null;
  }

  async getServiceAccountAccessToken(authConfig, scopes, options) {
    const delegatedUser = this.resolveDelegatedUser(authConfig, options);
    const cacheKey = JSON.stringify({
      scopes,
      delegatedUser
    });
    const cachedToken = this.cachedTokens.get(cacheKey);

    if (cachedToken && cachedToken.expiresAt > Date.now() + 60 * 1000) {
      return cachedToken.accessToken;
    }

    const credential = readCredentialFile(authConfig.credentialPath);

    if (
      !credential?.client_email ||
      !credential?.private_key ||
      !credential?.token_uri
    ) {
      throw new AppError(
        "AUTH_REQUIRED",
        "The service account credential file is missing required fields."
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: credential.client_email,
      scope: scopes.join(" "),
      aud: credential.token_uri,
      iat: now,
      exp: now + 3600
    };
    if (delegatedUser) {
      payload.sub = delegatedUser;
    }

    const assertion = signJwt(
      { alg: "RS256", typ: "JWT" },
      payload,
      credential.private_key
    );

    const response = await fetch(credential.token_uri, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      })
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new AppError(
        "AUTH_REQUIRED",
        "Unable to exchange the service account JWT for an access token.",
        {
          retryable: response.status >= 500,
          details: {
            status: response.status,
            responseText
          }
        }
      );
    }

    const payloadJson = await response.json();
    this.cachedTokens.set(cacheKey, {
      accessToken: payloadJson.access_token,
      expiresAt: Date.now() + payloadJson.expires_in * 1000
    });

    return this.cachedTokens.get(cacheKey).accessToken;
  }
}

export const googleAuthProvider = new GoogleAuthProvider();
