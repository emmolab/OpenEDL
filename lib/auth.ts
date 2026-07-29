import { env } from "cloudflare:workers";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ensureDatabase, getD1 } from "../db/core";
import { logInfo } from "./logging";

type RuntimeEnv = {
  ADMIN_TOKEN?: string;
  AUTH_BASE_URL?: string;
  AUTH_ALLOWED_DOMAINS?: string;
  AUTH_ALLOWED_EMAILS?: string;
  GOOGLE_OIDC_CLIENT_ID?: string;
  GOOGLE_OIDC_CLIENT_SECRET?: string;
  MICROSOFT_OIDC_CLIENT_ID?: string;
  MICROSOFT_OIDC_CLIENT_SECRET?: string;
  MICROSOFT_OIDC_TENANT_ID?: string;
  OIDC_PROVIDERS_JSON?: string;
  CONFIG_ENCRYPTION_KEY?: string;
};

export type ManagementRole = "admin" | "member";

export type ManagementIdentity = {
  id: number | null;
  name: string;
  email: string;
  picture: string | null;
  provider: string;
  role: ManagementRole;
};

export type ManagedUser = {
  id: number;
  provider: string;
  email: string;
  name: string;
  picture: string | null;
  role: ManagementRole;
  active: boolean;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
};

type OidcProvider = {
  id: string;
  name: string;
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
};

export type OidcProviderSetting = {
  id: string;
  name: string;
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  scopes: string;
  enabled: boolean;
  managed: boolean;
  hasClientSecret: boolean;
};

type OidcProviderRow = {
  id: string;
  name: string;
  issuer: string;
  discovery_url: string;
  client_id: string;
  client_secret_ciphertext: string;
  client_secret_iv: string;
  scopes: string;
  enabled: number;
};

type OidcMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

type SessionRow = {
  id: number;
  name: string;
  email: string;
  picture: string | null;
  provider: string;
  role: ManagementRole;
};

const runtimeEnv = env as unknown as RuntimeEnv;
const metadataCache = new Map<string, Promise<OidcMetadata>>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const SESSION_COOKIE = "openedl_session";
const SESSION_SECONDS = 12 * 60 * 60;
const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const MAX_LOGIN_ATTEMPTS = 5;
const MICROSOFT_TENANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseList(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function environmentProviders() {
  const providers: OidcProvider[] = [];

  if (
    runtimeEnv.GOOGLE_OIDC_CLIENT_ID &&
    runtimeEnv.GOOGLE_OIDC_CLIENT_SECRET
  ) {
    providers.push({
      id: "google",
      name: "Google",
      issuer: "https://accounts.google.com",
      discoveryUrl:
        "https://accounts.google.com/.well-known/openid-configuration",
      clientId: runtimeEnv.GOOGLE_OIDC_CLIENT_ID,
      clientSecret: runtimeEnv.GOOGLE_OIDC_CLIENT_SECRET,
      scopes: "openid profile email",
    });
  }

  if (
    runtimeEnv.MICROSOFT_OIDC_CLIENT_ID &&
    runtimeEnv.MICROSOFT_OIDC_CLIENT_SECRET
  ) {
    const tenant = runtimeEnv.MICROSOFT_OIDC_TENANT_ID?.trim() ?? "";
    if (!MICROSOFT_TENANT_ID_PATTERN.test(tenant)) {
      throw new Error(
        "MICROSOFT_OIDC_TENANT_ID must be the tenant UUID from Microsoft Entra ID.",
      );
    }
    const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
    providers.push({
      id: "microsoft",
      name: "Microsoft",
      issuer,
      discoveryUrl: `${issuer}/.well-known/openid-configuration`,
      clientId: runtimeEnv.MICROSOFT_OIDC_CLIENT_ID,
      clientSecret: runtimeEnv.MICROSOFT_OIDC_CLIENT_SECRET,
      scopes: "openid profile email",
    });
  }

  if (runtimeEnv.OIDC_PROVIDERS_JSON) {
    let customProviders: unknown;
    try {
      customProviders = JSON.parse(runtimeEnv.OIDC_PROVIDERS_JSON);
    } catch {
      throw new Error("OIDC_PROVIDERS_JSON is not valid JSON.");
    }

    if (!Array.isArray(customProviders)) {
      throw new Error("OIDC_PROVIDERS_JSON must contain an array.");
    }

    for (const value of customProviders) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Record<string, unknown>;
      const id = typeof candidate.id === "string" ? candidate.id : "";
      const name = typeof candidate.name === "string" ? candidate.name : "";
      const issuer =
        typeof candidate.issuer === "string" ? candidate.issuer : "";
      const clientId =
        typeof candidate.clientId === "string" ? candidate.clientId : "";
      const clientSecret =
        typeof candidate.clientSecret === "string"
          ? candidate.clientSecret
          : "";
      if (
        !/^[a-z0-9-]{2,32}$/.test(id) ||
        !name ||
        !clientId ||
        !clientSecret ||
        !issuer.startsWith("https://")
      ) {
        throw new Error(`Invalid custom OIDC provider: ${id || "unknown"}.`);
      }

      const normalizedIssuer = issuer.replace(/\/+$/, "");
      providers.push({
        id,
        name,
        issuer: normalizedIssuer,
        discoveryUrl:
          typeof candidate.discoveryUrl === "string" &&
          candidate.discoveryUrl.startsWith("https://")
            ? candidate.discoveryUrl
            : `${normalizedIssuer}/.well-known/openid-configuration`,
        clientId,
        clientSecret,
        scopes:
          typeof candidate.scopes === "string"
            ? candidate.scopes
            : "openid profile email",
      });
    }
  }

  return providers;
}

async function configuredProviders() {
  const providers = new Map(
    environmentProviders().map((provider) => [provider.id, provider]),
  );
  await ensureDatabase();
  const { results } = await getD1()
    .prepare("SELECT * FROM oidc_providers WHERE enabled = 1 ORDER BY name")
    .all<OidcProviderRow>();
  for (const row of results) {
    if (providers.has(row.id)) continue;
    providers.set(row.id, {
      id: row.id,
      name: row.name,
      issuer: row.issuer,
      discoveryUrl: row.discovery_url,
      clientId: row.client_id,
      clientSecret: await decryptProviderSecret(
        row.id,
        row.client_secret_ciphertext,
        row.client_secret_iv,
      ),
      scopes: row.scopes,
    });
  }
  return [...providers.values()];
}

export async function listOidcProviders() {
  return (await configuredProviders()).map(({ id, name }) => ({ id, name }));
}

export function hasAdminToken() {
  return Boolean(runtimeEnv.ADMIN_TOKEN?.trim());
}

async function getProvider(providerId: string) {
  return (await configuredProviders()).find(
    (provider) => provider.id === providerId,
  );
}

async function getMetadata(provider: OidcProvider) {
  let pending = metadataCache.get(provider.discoveryUrl);
  if (!pending) {
    pending = fetch(provider.discoveryUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `${provider.name} discovery returned HTTP ${response.status}.`,
        );
      }
      const metadata = (await response.json()) as Partial<OidcMetadata>;
      if (
        !metadata.issuer ||
        !metadata.authorization_endpoint?.startsWith("https://") ||
        !metadata.token_endpoint?.startsWith("https://") ||
        !metadata.jwks_uri?.startsWith("https://")
      ) {
        throw new Error(`${provider.name} returned invalid OIDC metadata.`);
      }
      return metadata as OidcMetadata;
    });
    metadataCache.set(provider.discoveryUrl, pending);
  }
  return pending;
}

export function hasConfigEncryptionKey() {
  return Boolean(runtimeEnv.CONFIG_ENCRYPTION_KEY?.trim());
}

export async function listOidcProviderSettings() {
  await ensureDatabase();
  const settings = new Map<string, OidcProviderSetting>();
  for (const provider of environmentProviders()) {
    settings.set(provider.id, {
      id: provider.id,
      name: provider.name,
      issuer: provider.issuer,
      discoveryUrl: provider.discoveryUrl,
      clientId: provider.clientId,
      scopes: provider.scopes,
      enabled: true,
      managed: false,
      hasClientSecret: true,
    });
  }
  const { results } = await getD1()
    .prepare("SELECT * FROM oidc_providers ORDER BY name")
    .all<OidcProviderRow>();
  for (const row of results) {
    if (settings.has(row.id)) continue;
    settings.set(row.id, {
      id: row.id,
      name: row.name,
      issuer: row.issuer,
      discoveryUrl: row.discovery_url,
      clientId: row.client_id,
      scopes: row.scopes,
      enabled: Boolean(row.enabled),
      managed: true,
      hasClientSecret: Boolean(row.client_secret_ciphertext),
    });
  }
  return [...settings.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function normalizeOidcSetting(input: {
  id?: string;
  name?: string;
  issuer?: string;
  discoveryUrl?: string;
  clientId?: string;
  scopes?: string;
  enabled?: boolean;
}) {
  const id = input.id?.trim().toLowerCase() ?? "";
  const name = input.name?.trim() ?? "";
  const issuer = input.issuer?.trim().replace(/\/+$/, "") ?? "";
  const discoveryUrl =
    input.discoveryUrl?.trim() ||
    `${issuer}/.well-known/openid-configuration`;
  const clientId = input.clientId?.trim() ?? "";
  const scopes = input.scopes?.trim() || "openid profile email";
  if (!/^[a-z0-9-]{2,32}$/.test(id)) {
    throw new Error("Provider id must use 2–32 lowercase letters, numbers, or dashes.");
  }
  if (name.length < 2 || name.length > 60) {
    throw new Error("Provider name must be 2–60 characters.");
  }
  if (!issuer.startsWith("https://") || !discoveryUrl.startsWith("https://")) {
    throw new Error("Issuer and discovery URLs must use HTTPS.");
  }
  if (id === "microsoft") {
    const tenant =
      /^https:\/\/login\.microsoftonline\.com\/([^/]+)\/v2\.0$/i.exec(
        issuer,
      )?.[1] ?? "";
    if (!MICROSOFT_TENANT_ID_PATTERN.test(tenant)) {
      throw new Error(
        "Microsoft Entra ID requires a tenant-specific issuer containing the directory tenant UUID.",
      );
    }
  }
  if (!clientId || clientId.length > 512) {
    throw new Error("A valid client id is required.");
  }
  if (!scopes.split(/\s+/).includes("openid")) {
    throw new Error("OIDC scopes must include openid.");
  }
  return {
    id,
    name,
    issuer,
    discoveryUrl,
    clientId,
    scopes,
    enabled: input.enabled !== false,
  };
}

export async function createOidcProviderSetting(input: {
  id?: string;
  name?: string;
  issuer?: string;
  discoveryUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string;
  enabled?: boolean;
}) {
  await ensureDatabase();
  const setting = normalizeOidcSetting(input);
  const clientSecret = input.clientSecret ?? "";
  if (!clientSecret || clientSecret.length > 2048) {
    throw new Error("A valid client secret is required.");
  }
  if (environmentProviders().some((provider) => provider.id === setting.id)) {
    throw new Error(
      "That provider id is already configured through environment variables.",
    );
  }
  const encrypted = await encryptProviderSecret(setting.id, clientSecret);
  try {
    await getD1()
      .prepare(
        `INSERT INTO oidc_providers (
          id, name, issuer, discovery_url, client_id,
          client_secret_ciphertext, client_secret_iv, scopes, enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        setting.id,
        setting.name,
        setting.issuer,
        setting.discoveryUrl,
        setting.clientId,
        encrypted.ciphertext,
        encrypted.iv,
        setting.scopes,
        setting.enabled ? 1 : 0,
      )
      .run();
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      throw new Error("A provider already uses that id.");
    }
    throw error;
  }
  metadataCache.delete(setting.discoveryUrl);
  logInfo("sso.provider.created", {
    providerId: setting.id,
    enabled: setting.enabled,
  });
  return setting.id;
}

export async function updateOidcProviderSetting(
  providerId: string,
  input: {
    name?: string;
    issuer?: string;
    discoveryUrl?: string;
    clientId?: string;
    clientSecret?: string;
    scopes?: string;
    enabled?: boolean;
  },
) {
  await ensureDatabase();
  const database = getD1();
  const existing = await database
    .prepare("SELECT * FROM oidc_providers WHERE id = ?")
    .bind(providerId)
    .first<OidcProviderRow>();
  if (!existing) throw new Error("GUI-managed OIDC provider not found.");
  const setting = normalizeOidcSetting({
    id: providerId,
    name: input.name ?? existing.name,
    issuer: input.issuer ?? existing.issuer,
    discoveryUrl: input.discoveryUrl ?? existing.discovery_url,
    clientId: input.clientId ?? existing.client_id,
    scopes: input.scopes ?? existing.scopes,
    enabled: input.enabled ?? Boolean(existing.enabled),
  });
  let ciphertext: string | null = null;
  let iv: string | null = null;
  if (input.clientSecret) {
    if (input.clientSecret.length > 2048) {
      throw new Error("Client secret is too long.");
    }
    const encrypted = await encryptProviderSecret(providerId, input.clientSecret);
    ciphertext = encrypted.ciphertext;
    iv = encrypted.iv;
  }
  await database
    .prepare(
      `UPDATE oidc_providers SET
        name = ?, issuer = ?, discovery_url = ?, client_id = ?,
        client_secret_ciphertext = COALESCE(?, client_secret_ciphertext),
        client_secret_iv = COALESCE(?, client_secret_iv),
        scopes = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(
      setting.name,
      setting.issuer,
      setting.discoveryUrl,
      setting.clientId,
      ciphertext,
      iv,
      setting.scopes,
      setting.enabled ? 1 : 0,
      providerId,
    )
    .run();
  metadataCache.delete(existing.discovery_url);
  metadataCache.delete(setting.discoveryUrl);
  logInfo("sso.provider.updated", {
    providerId,
    enabled: setting.enabled,
    credentialReplaced: Boolean(input.clientSecret),
  });
}

export async function deleteOidcProviderSetting(providerId: string) {
  await ensureDatabase();
  const result = await getD1()
    .prepare("DELETE FROM oidc_providers WHERE id = ?")
    .bind(providerId)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new Error("GUI-managed OIDC provider not found.");
  }
  logInfo("sso.provider.deleted", { providerId });
}

export async function testOidcProviderSetting(providerId: string) {
  const provider = await getProvider(providerId);
  if (!provider) {
    await ensureDatabase();
    const row = await getD1()
      .prepare("SELECT * FROM oidc_providers WHERE id = ?")
      .bind(providerId)
      .first<OidcProviderRow>();
    if (!row) throw new Error("OIDC provider not found.");
    const metadata = await getMetadata({
      id: row.id,
      name: row.name,
      issuer: row.issuer,
      discoveryUrl: row.discovery_url,
      clientId: row.client_id,
      clientSecret: await decryptProviderSecret(
        row.id,
        row.client_secret_ciphertext,
        row.client_secret_iv,
      ),
      scopes: row.scopes,
    });
    return { issuer: metadata.issuer };
  }
  return { issuer: (await getMetadata(provider)).issuer };
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return toBase64Url(value);
}

function toBase64Url(value: Uint8Array) {
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return toBase64Url(new Uint8Array(digest));
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function configEncryptionKey() {
  const encoded = runtimeEnv.CONFIG_ENCRYPTION_KEY?.trim();
  if (!encoded) {
    throw new Error(
      "CONFIG_ENCRYPTION_KEY is required before SSO providers can be managed in the GUI.",
    );
  }
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = fromBase64Url(encoded);
  } catch {
    throw new Error("CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  if (keyBytes.byteLength !== 32) {
    throw new Error("CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptProviderSecret(providerId: string, secret: string) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(providerId),
    },
    await configEncryptionKey(),
    new TextEncoder().encode(secret),
  );
  return {
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    iv: toBase64Url(iv),
  };
}

async function decryptProviderSecret(
  providerId: string,
  ciphertext: string,
  iv: string,
) {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64Url(iv),
        additionalData: new TextEncoder().encode(providerId),
      },
      await configEncryptionKey(),
      fromBase64Url(ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof Error && error.message.includes("CONFIG_ENCRYPTION_KEY")) {
      throw error;
    }
    throw new Error(
      `Unable to decrypt the client secret for OIDC provider “${providerId}”.`,
    );
  }
}

async function derivePassword(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function normalizedEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

function validatePassword(password: string) {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
}

async function hashPassword(password: string) {
  validatePassword(password);
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return {
    hash: toBase64Url(hash),
    salt: toBase64Url(salt),
    iterations: PASSWORD_ITERATIONS,
  };
}

async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
  iterations: number,
) {
  if (password.length > PASSWORD_MAX_LENGTH) return false;
  const candidate = await derivePassword(
    password,
    fromBase64Url(salt),
    iterations,
  );
  return constantTimeEqual(candidate, fromBase64Url(hash));
}

function safeReturnTo(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://openedl.local");
    return url.origin === "https://openedl.local"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  } catch {
    return "/";
  }
}

function requestBaseUrl(request: Request) {
  if (runtimeEnv.AUTH_BASE_URL) {
    return new URL(runtimeEnv.AUTH_BASE_URL).origin;
  }
  return new URL(request.url).origin;
}

function callbackUrl(request: Request, providerId: string) {
  return `${requestBaseUrl(request)}/api/auth/callback/${providerId}`;
}

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function sessionCookie(request: Request, value: string, maxAge: number) {
  const secure = requestBaseUrl(request).startsWith("https://");
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function issuerMatches(
  provider: OidcProvider,
  metadataIssuer: string,
  tokenIssuer: string,
) {
  if (provider.id === "google") {
    return ["https://accounts.google.com", "accounts.google.com"].includes(
      tokenIssuer,
    );
  }

  if (metadataIssuer.includes("{tenantid}")) {
    const pattern = metadataIssuer
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace("\\{tenantid\\}", "[0-9a-f-]{36}");
    return new RegExp(`^${pattern}$`, "i").test(tokenIssuer);
  }

  return tokenIssuer === metadataIssuer || tokenIssuer === provider.issuer;
}

function claimString(payload: JWTPayload, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function enforceIdentityAllowlist(email: string) {
  const normalizedEmail = email.toLowerCase();
  const allowedEmails = parseList(runtimeEnv.AUTH_ALLOWED_EMAILS);
  const allowedDomains = parseList(runtimeEnv.AUTH_ALLOWED_DOMAINS);
  if (allowedEmails.size === 0 && allowedDomains.size === 0) return;

  const domain = normalizedEmail.split("@").at(-1) ?? "";
  if (
    !allowedEmails.has(normalizedEmail) &&
    !allowedDomains.has(domain)
  ) {
    throw new Error("This account is not allowed to manage OpenEDL.");
  }
}

async function createSession(request: Request, userId: number) {
  const database = getD1();
  const sessionToken = randomToken(48);
  const sessionHash = await sha256(sessionToken);
  await database.batch([
    database
      .prepare("DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP"),
    database
      .prepare(
        `INSERT INTO auth_sessions (
          token_hash, user_id, expires_at
        ) VALUES (?, ?, datetime('now', '+12 hours'))`,
      )
      .bind(sessionHash, userId),
  ]);
  return sessionCookie(request, sessionToken, SESSION_SECONDS);
}

export async function beginOidcLogin(
  request: Request,
  providerId: string,
  returnTo: string | null,
) {
  const provider = await getProvider(providerId);
  if (!provider) throw new Error("OIDC provider is not configured.");

  const [metadata, state, nonce, codeVerifier] = await Promise.all([
    getMetadata(provider),
    Promise.resolve(randomToken()),
    Promise.resolve(randomToken()),
    Promise.resolve(randomToken(48)),
  ]);
  const [stateHash, codeChallenge] = await Promise.all([
    sha256(state),
    sha256(codeVerifier),
  ]);

  await ensureDatabase();
  const database = getD1();
  await database.batch([
    database
      .prepare(
        `DELETE FROM auth_challenges
         WHERE expires_at <= CURRENT_TIMESTAMP`,
      ),
    database
      .prepare(
        `INSERT INTO auth_challenges (
          state_hash, provider, nonce, code_verifier, return_to, expires_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now', '+10 minutes'))`,
      )
      .bind(
        stateHash,
        provider.id,
        nonce,
        codeVerifier,
        safeReturnTo(returnTo),
      ),
  ]);

  const authorizationUrl = new URL(metadata.authorization_endpoint);
  authorizationUrl.searchParams.set("client_id", provider.clientId);
  authorizationUrl.searchParams.set("redirect_uri", callbackUrl(request, provider.id));
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", provider.scopes);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("prompt", "select_account");

  return authorizationUrl;
}

export async function completeOidcLogin(
  request: Request,
  providerId: string,
  code: string,
  state: string,
) {
  const provider = await getProvider(providerId);
  if (!provider) throw new Error("OIDC provider is not configured.");

  await ensureDatabase();
  const database = getD1();
  const stateHash = await sha256(state);
  const challenge = await database
    .prepare(
      `SELECT provider, nonce, code_verifier, return_to
       FROM auth_challenges
       WHERE state_hash = ? AND expires_at > CURRENT_TIMESTAMP`,
    )
    .bind(stateHash)
    .first<{
      provider: string;
      nonce: string;
      code_verifier: string;
      return_to: string;
    }>();
  await database
    .prepare("DELETE FROM auth_challenges WHERE state_hash = ?")
    .bind(stateHash)
    .run();

  if (!challenge || challenge.provider !== provider.id) {
    throw new Error("The sign-in request is missing or expired.");
  }

  const metadata = await getMetadata(provider);
  const tokenResponse = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(request, provider.id),
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code_verifier: challenge.code_verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const tokenPayload = (await tokenResponse.json()) as {
    id_token?: string;
    error_description?: string;
  };
  if (!tokenResponse.ok || !tokenPayload.id_token) {
    throw new Error(
      tokenPayload.error_description ?? "The identity provider rejected sign-in.",
    );
  }

  let remoteJwks = jwksCache.get(metadata.jwks_uri);
  if (!remoteJwks) {
    remoteJwks = createRemoteJWKSet(new URL(metadata.jwks_uri), {
      timeoutDuration: 10_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 60 * 60 * 1000,
    });
    jwksCache.set(metadata.jwks_uri, remoteJwks);
  }

  const { payload } = await jwtVerify(tokenPayload.id_token, remoteJwks, {
    audience: provider.clientId,
    algorithms: ["RS256", "ES256"],
    clockTolerance: 60,
  });
  const tokenIssuer = claimString(payload, "iss");
  if (
    !tokenIssuer ||
    !issuerMatches(provider, metadata.issuer, tokenIssuer) ||
    payload.nonce !== challenge.nonce
  ) {
    throw new Error("The identity token failed issuer or nonce validation.");
  }

  const subject = payload.sub;
  const email =
    claimString(payload, "email") ??
    claimString(payload, "preferred_username") ??
    claimString(payload, "upn");
  if (!subject || !email) {
    throw new Error("The identity provider did not return an email address.");
  }
  if (payload.email_verified === false) {
    throw new Error("The identity provider has not verified this email.");
  }
  enforceIdentityAllowlist(email);

  const name =
    claimString(payload, "name") ??
    claimString(payload, "given_name") ??
    email;
  const picture = claimString(payload, "picture");
  await database
    .prepare(
      `INSERT INTO auth_users (
        provider, subject, email, name, picture, role, updated_at, last_login_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        CASE
          WHEN EXISTS (SELECT 1 FROM auth_users WHERE active = 1 AND role = 'admin')
          THEN 'member'
          ELSE 'admin'
        END,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT(provider, subject) DO UPDATE SET
        email = excluded.email,
        picture = excluded.picture,
        updated_at = CURRENT_TIMESTAMP,
        last_login_at = CURRENT_TIMESTAMP`,
    )
    .bind(provider.id, subject, email.toLowerCase(), name, picture)
    .run();
  const user = await database
    .prepare(
      `SELECT id, active
       FROM auth_users
       WHERE provider = ? AND subject = ?`,
    )
    .bind(provider.id, subject)
    .first<{ id: number; active: number }>();
  if (!user) throw new Error("Unable to create the local user session.");
  if (!user.active) throw new Error("This OpenEDL account is disabled.");

  logInfo("auth.sso.succeeded", {
    providerId: provider.id,
    userId: user.id,
  });
  return {
    returnTo: safeReturnTo(challenge.return_to),
    cookie: await createSession(request, user.id),
  };
}

export async function getManagementIdentity(
  request: Request,
): Promise<ManagementIdentity | null> {
  const configuredToken = runtimeEnv.ADMIN_TOKEN?.trim();
  const authorization = request.headers.get("authorization");
  if (configuredToken && authorization === `Bearer ${configuredToken}`) {
    return {
      id: null,
      name: "Token administrator",
      email: "admin-token@local",
      picture: null,
      provider: "token",
      role: "admin",
    };
  }

  const sessionToken = cookieValue(request, SESSION_COOKIE);
  if (sessionToken) {
    await ensureDatabase();
    const tokenHash = await sha256(sessionToken);
    const user = await getD1()
      .prepare(
        `SELECT auth_users.id, auth_users.name, auth_users.email,
                auth_users.picture, auth_users.provider, auth_users.role
         FROM auth_sessions
         INNER JOIN auth_users ON auth_users.id = auth_sessions.user_id
         WHERE auth_sessions.token_hash = ?
           AND auth_sessions.expires_at > CURRENT_TIMESTAMP
           AND auth_users.active = 1`,
      )
      .bind(tokenHash)
      .first<SessionRow>();
    if (user) return user;
  }

  return null;
}

export async function isManagementAuthorized(request: Request) {
  return Boolean(await getManagementIdentity(request));
}

export async function isUserAdministrator(request: Request) {
  return (await getManagementIdentity(request))?.role === "admin";
}

export async function updateOwnProfile(
  request: Request,
  identity: ManagementIdentity,
  input: {
    name?: string;
    email?: string;
    currentPassword?: string;
    newPassword?: string;
  },
) {
  if (identity.id === null) {
    throw new Error("Recovery identities do not have profiles.");
  }
  await ensureDatabase();
  const database = getD1();
  const user = await database
    .prepare(
      `SELECT id, provider, email, password_hash, password_salt,
              password_iterations
       FROM auth_users
       WHERE id = ? AND active = 1 AND deleted_at IS NULL`,
    )
    .bind(identity.id)
    .first<{
      id: number;
      provider: string;
      email: string;
      password_hash: string | null;
      password_salt: string | null;
      password_iterations: number | null;
    }>();
  if (!user) throw new Error("Profile not found.");

  const changesCredentials =
    input.email !== undefined || input.newPassword !== undefined;
  if (changesCredentials && user.provider !== "local") {
    throw new Error("SSO email and credentials are managed by your provider.");
  }
  if (changesCredentials) {
    const currentPassword = input.currentPassword ?? "";
    const valid =
      Boolean(user.password_hash && user.password_salt) &&
      (await verifyPassword(
        currentPassword,
        user.password_hash ?? "",
        user.password_salt ?? "",
        user.password_iterations ?? PASSWORD_ITERATIONS,
      ));
    if (!valid) throw new Error("Current password is incorrect.");
  }

  const statements: D1PreparedStatement[] = [];
  if (input.name !== undefined) {
    statements.push(
      database
        .prepare(
          "UPDATE auth_users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(validateName(input.name), user.id),
    );
  }
  if (input.email !== undefined) {
    const email = normalizedEmail(input.email);
    statements.push(
      database
        .prepare(
          `UPDATE auth_users SET subject = ?, email = ?,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(email, email, user.id),
    );
  }
  if (input.newPassword !== undefined) {
    const password = await hashPassword(input.newPassword);
    statements.push(
      database
        .prepare(
          `UPDATE auth_users SET password_hash = ?, password_salt = ?,
            password_iterations = ?, failed_login_attempts = 0,
            locked_until = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(password.hash, password.salt, password.iterations, user.id),
    );
    const currentSession = cookieValue(request, SESSION_COOKIE);
    if (currentSession) {
      statements.push(
        database
          .prepare(
            "DELETE FROM auth_sessions WHERE user_id = ? AND token_hash <> ?",
          )
          .bind(user.id, await sha256(currentSession)),
      );
    } else {
      statements.push(
        database.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(user.id),
      );
    }
  }
  if (statements.length === 0) throw new Error("No profile changes were supplied.");

  try {
    await database.batch(statements);
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      throw new Error("A local account already uses that email address.");
    }
    throw error;
  }
  const updated = await getManagementIdentity(request);
  if (!updated) throw new Error("Profile updated, but the session is no longer valid.");
  return updated;
}

export class LocalAuthenticationError extends Error {
  constructor(
    message: string,
    public readonly status = 401,
  ) {
    super(message);
  }
}

export class InitialSetupError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export async function isInitialSetupRequired() {
  await ensureDatabase();
  const row = await getD1()
    .prepare("SELECT COUNT(*) AS count FROM auth_users")
    .first<{ count: number }>();
  return (row?.count ?? 0) === 0;
}

export async function createInitialAdministrator(
  request: Request,
  input: {
    name: string;
    email: string;
    password: string;
  },
) {
  await ensureDatabase();

  const name = validateName(input.name);
  const email = normalizedEmail(input.email);
  const password = await hashPassword(input.password);
  const result = await getD1()
    .prepare(
      `INSERT INTO auth_users (
        provider, subject, email, name, role, active, password_hash,
        password_salt, password_iterations, updated_at, last_login_at
      )
      SELECT
        'local', ?, ?, ?, 'admin', 1, ?, ?, ?,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (SELECT 1 FROM auth_users)`,
    )
    .bind(
      email,
      email,
      name,
      password.hash,
      password.salt,
      password.iterations,
    )
    .run();

  if (result.meta.changes !== 1) {
    throw new InitialSetupError(
      "Initial setup is already complete. Sign in with an existing account.",
      409,
    );
  }

  const userId = Number(result.meta.last_row_id);
  const user = await getManagedUser(userId);
  if (!user) {
    throw new Error("The administrator was created but could not be loaded.");
  }

  logInfo("auth.setup.completed", { userId });
  return {
    cookie: await createSession(request, userId),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      picture: user.picture,
      provider: user.provider,
      role: user.role,
    } satisfies ManagementIdentity,
  };
}

export async function loginWithLocalAccount(
  request: Request,
  emailValue: string,
  password: string,
) {
  await ensureDatabase();
  const database = getD1();
  let email: string;
  try {
    email = normalizedEmail(emailValue);
  } catch {
    throw new LocalAuthenticationError("Invalid email or password.");
  }

  const user = await database
    .prepare(
      `SELECT id, active, password_hash, password_salt, password_iterations,
              locked_until > CURRENT_TIMESTAMP AS locked
       FROM auth_users
       WHERE provider = 'local' AND subject = ?`,
    )
    .bind(email)
    .first<{
      id: number;
      active: number;
      password_hash: string | null;
      password_salt: string | null;
      password_iterations: number | null;
      locked: number;
    }>();

  if (!user) {
    await derivePassword(
      password.slice(0, PASSWORD_MAX_LENGTH),
      new Uint8Array(16),
      PASSWORD_ITERATIONS,
    );
    throw new LocalAuthenticationError("Invalid email or password.");
  }
  if (user.locked) {
    throw new LocalAuthenticationError(
      "Too many sign-in attempts. Try again in 15 minutes.",
      429,
    );
  }

  const valid =
    Boolean(user.password_hash && user.password_salt) &&
    (await verifyPassword(
      password,
      user.password_hash ?? "",
      user.password_salt ?? "",
      user.password_iterations ?? PASSWORD_ITERATIONS,
    ));
  if (!valid || !user.active) {
    await database
      .prepare(
        `UPDATE auth_users SET
          failed_login_attempts =
            CASE WHEN failed_login_attempts + 1 >= ? THEN 0
                 ELSE failed_login_attempts + 1 END,
          locked_until =
            CASE WHEN failed_login_attempts + 1 >= ?
                 THEN datetime('now', '+15 minutes')
                 ELSE NULL END,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(MAX_LOGIN_ATTEMPTS, MAX_LOGIN_ATTEMPTS, user.id)
      .run();
    throw new LocalAuthenticationError("Invalid email or password.");
  }

  await database
    .prepare(
      `UPDATE auth_users SET
        failed_login_attempts = 0,
        locked_until = NULL,
        last_login_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(user.id)
    .run();
  logInfo("auth.local.succeeded", { userId: user.id });
  return createSession(request, user.id);
}

function validateRole(value: string): ManagementRole {
  if (value !== "admin" && value !== "member") {
    throw new Error("Role must be admin or member.");
  }
  return value;
}

function validateName(value: string) {
  const name = value.trim();
  if (name.length < 2 || name.length > 100) {
    throw new Error("Name must be 2–100 characters.");
  }
  return name;
}

function mapManagedUser(row: {
  id: number;
  provider: string;
  email: string;
  name: string;
  picture: string | null;
  role: ManagementRole;
  active: number;
  password_hash: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string;
}): ManagedUser {
  return {
    id: row.id,
    provider: row.provider,
    email: row.email,
    name: row.name,
    picture: row.picture,
    role: row.role,
    active: Boolean(row.active),
    hasPassword: Boolean(row.password_hash),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

const managedUserSelect = `SELECT
  id, provider, email, name, picture, role, active, password_hash,
  created_at, updated_at, last_login_at
FROM auth_users`;

export async function listManagedUsers() {
  await ensureDatabase();
  const { results } = await getD1()
    .prepare(
      `${managedUserSelect}
       WHERE deleted_at IS NULL
       ORDER BY active DESC, name, email`,
    )
    .all<Parameters<typeof mapManagedUser>[0]>();
  return results.map(mapManagedUser);
}

export async function createLocalAccount(input: {
  name: string;
  email: string;
  password: string;
  role: string;
}) {
  await ensureDatabase();
  const name = validateName(input.name);
  const email = normalizedEmail(input.email);
  const role = validateRole(input.role);
  const password = await hashPassword(input.password);

  try {
    const result = await getD1()
      .prepare(
        `INSERT INTO auth_users (
          provider, subject, email, name, role, active, password_hash,
          password_salt, password_iterations, updated_at, last_login_at
        ) VALUES (
          'local', ?, ?, ?, ?, 1, ?, ?, ?,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
      )
      .bind(
        email,
        email,
        name,
        role,
        password.hash,
        password.salt,
        password.iterations,
      )
      .run();
    return getManagedUser(Number(result.meta.last_row_id));
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      throw new Error("A local account already uses that email address.");
    }
    throw error;
  }
}

export async function getManagedUser(userId: number) {
  await ensureDatabase();
  const row = await getD1()
    .prepare(`${managedUserSelect} WHERE id = ? AND deleted_at IS NULL`)
    .bind(userId)
    .first<Parameters<typeof mapManagedUser>[0]>();
  return row ? mapManagedUser(row) : null;
}

async function assertAdminCanBeReduced(
  actorId: number | null,
  target: { id: number; role: ManagementRole; active: number },
) {
  if (actorId === target.id) {
    throw new Error("You cannot disable, demote, or delete your own account.");
  }
  if (target.role !== "admin" || !target.active) return;
  const row = await getD1()
    .prepare(
      "SELECT COUNT(*) AS count FROM auth_users WHERE role = 'admin' AND active = 1",
    )
    .first<{ count: number }>();
  if ((row?.count ?? 0) <= 1) {
    throw new Error("At least one active administrator is required.");
  }
}

export async function updateManagedUser(
  actorId: number | null,
  userId: number,
  input: {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
    active?: boolean;
  },
) {
  await ensureDatabase();
  const database = getD1();
  const target = await database
    .prepare(
      `SELECT id, provider, role, active
       FROM auth_users
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(userId)
    .first<{
      id: number;
      provider: string;
      role: ManagementRole;
      active: number;
    }>();
  if (!target) throw new Error("User not found.");

  const reducingAdmin =
    (input.role !== undefined &&
      validateRole(input.role) !== "admin" &&
      target.role === "admin") ||
    (input.active === false && Boolean(target.active));
  if (reducingAdmin) await assertAdminCanBeReduced(actorId, target);

  const statements: D1PreparedStatement[] = [];
  if (input.name !== undefined) {
    statements.push(
      database
        .prepare(
          "UPDATE auth_users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(validateName(input.name), userId),
    );
  }
  if (input.email !== undefined) {
    if (target.provider !== "local") {
      throw new Error("OIDC email addresses are managed by the provider.");
    }
    const email = normalizedEmail(input.email);
    statements.push(
      database
        .prepare(
          `UPDATE auth_users SET subject = ?, email = ?,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(email, email, userId),
    );
  }
  if (input.role !== undefined) {
    statements.push(
      database
        .prepare(
          "UPDATE auth_users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(validateRole(input.role), userId),
    );
  }
  if (input.active !== undefined) {
    statements.push(
      database
        .prepare(
          "UPDATE auth_users SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(input.active ? 1 : 0, userId),
    );
    if (!input.active) {
      statements.push(
        database
          .prepare("DELETE FROM auth_sessions WHERE user_id = ?")
          .bind(userId),
      );
    }
  }
  if (input.password !== undefined) {
    if (target.provider !== "local") {
      throw new Error("OIDC users do not have local passwords.");
    }
    const password = await hashPassword(input.password);
    statements.push(
      database
        .prepare(
          `UPDATE auth_users SET password_hash = ?, password_salt = ?,
            password_iterations = ?, failed_login_attempts = 0,
            locked_until = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(password.hash, password.salt, password.iterations, userId),
    );
    statements.push(
      database.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId),
    );
  }
  if (statements.length === 0) throw new Error("No user changes were supplied.");

  try {
    await database.batch(statements);
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      throw new Error("A local account already uses that email address.");
    }
    throw error;
  }
  return getManagedUser(userId);
}

export async function deleteManagedUser(
  actorId: number | null,
  userId: number,
) {
  await ensureDatabase();
  const database = getD1();
  const target = await database
    .prepare(
      `SELECT id, provider, role, active
       FROM auth_users
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(userId)
    .first<{
      id: number;
      provider: string;
      role: ManagementRole;
      active: number;
    }>();
  if (!target) throw new Error("User not found.");
  if (target.role === "admin" && target.active) {
    await assertAdminCanBeReduced(actorId, target);
  } else if (actorId === target.id) {
    throw new Error("You cannot delete your own account.");
  }
  if (target.provider === "local") {
    await database.prepare("DELETE FROM auth_users WHERE id = ?").bind(userId).run();
    return;
  }
  await database.batch([
    database
      .prepare(
        `UPDATE auth_users SET active = 0, deleted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(userId),
    database.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId),
  ]);
}

export async function endManagementSession(request: Request) {
  const sessionToken = cookieValue(request, SESSION_COOKIE);
  if (sessionToken) {
    await ensureDatabase();
    await getD1()
      .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .bind(await sha256(sessionToken))
      .run();
  }
  return sessionCookie(request, "", 0);
}
