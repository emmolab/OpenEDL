export type EdlType = "ip" | "domain" | "url";
export type SourceFormat = "auto" | "text" | "json" | "csv";
export type SourceRole = "include" | "exclude";
export type SourceStatus = "pending" | "healthy" | "degraded" | "disabled";

const DEFAULT_MAX_SOURCE_BYTES = 2_000_000;
const PRIVATE_IPV4_PATTERNS = [
  /^0\./,
  /^10\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.0\.0\./,
  /^192\.0\.2\./,
  /^192\.168\./,
  /^198\.(1[89])\./,
  /^198\.51\.100\./,
  /^203\.0\.113\./,
  /^(22[4-9]|23\d)\./,
  /^(24\d|25[0-5])\./,
];

function normalizeIpv4(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const normalized = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return null;
    const number = Number(part);
    return number >= 0 && number <= 255 ? String(number) : null;
  });

  return normalized.every((part) => part !== null)
    ? normalized.join(".")
    : null;
}

function normalizeIpPart(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.includes(":")) {
    return /^[0-9a-f:]+$/.test(trimmed) && trimmed.includes(":")
      ? trimmed
      : null;
  }
  return normalizeIpv4(trimmed);
}

function normalizeIp(value: string) {
  const rangeParts = value.split(/\s*-\s*/);
  if (rangeParts.length === 2) {
    const start = normalizeIpPart(rangeParts[0]);
    const end = normalizeIpPart(rangeParts[1]);
    return start && end ? `${start}-${end}` : null;
  }

  const cidrParts = value.split("/");
  if (cidrParts.length > 2) return null;

  const address = normalizeIpPart(cidrParts[0]);
  if (!address) return null;
  if (cidrParts.length === 1) return address;

  const prefix = Number(cidrParts[1]);
  const maxPrefix = address.includes(":") ? 128 : 32;
  return Number.isInteger(prefix) && prefix >= 0 && prefix <= maxPrefix
    ? `${address}/${prefix}`
    : null;
}

function normalizeDomain(value: string) {
  let candidate = value.trim().toLowerCase();
  if (!candidate || /\s/.test(candidate)) return null;

  candidate = candidate.replace(/^\^/, "");
  candidate = candidate.replace(/^\*\./, "");
  candidate = candidate.replace(/\.$/, "");

  if (
    candidate.includes("/") ||
    candidate.includes(":") ||
    candidate.length > 253
  ) {
    return null;
  }

  const labels = candidate.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    return null;
  }

  return candidate;
}

function normalizeUrlEntry(value: string) {
  let candidate = value.trim();
  if (!candidate || /\s/.test(candidate)) return null;

  candidate = candidate.replace(/^https?:\/\//i, "");
  candidate = candidate.replace(/^\/\//, "");
  candidate = candidate.replace(/\/+$/, "");
  if (!candidate || candidate.length > 2048) return null;

  const slashIndex = candidate.indexOf("/");
  const hostname =
    slashIndex === -1 ? candidate : candidate.slice(0, slashIndex);
  if (!normalizeDomain(hostname.replace(/^\*\./, ""))) return null;

  return candidate;
}

function stripInlineComment(value: string) {
  return value
    .replace(/\s+[;#].*$/, "")
    .replace(/\s+\/\/.*$/, "")
    .trim();
}

function flattenJson(value: unknown, output: string[]) {
  if (typeof value === "string" || typeof value === "number") {
    output.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => flattenJson(item, output));
    return;
  }

  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => flattenJson(item, output));
  }
}

function parseCsv(raw: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quoted) {
      if (character === '"' && raw[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }
  row.push(cell.trim());
  rows.push(row);
  return rows;
}

function selectJsonPath(value: unknown, path: string) {
  let values = [value];
  for (const segment of path.split(".").map((part) => part.trim()).filter(Boolean)) {
    const wildcard = segment.endsWith("[]");
    const key = wildcard ? segment.slice(0, -2) : segment;
    values = values.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object" || !(key in candidate)) {
        return [];
      }
      const selected = (candidate as Record<string, unknown>)[key];
      if (wildcard) return Array.isArray(selected) ? selected : [];
      return [selected];
    });
  }
  return values;
}

function extractCandidates(raw: string, format: SourceFormat, jsonPath = "") {
  const detectedFormat =
    format === "auto"
      ? raw.trimStart().startsWith("{") || raw.trimStart().startsWith("[")
        ? "json"
        : raw.includes(",")
          ? "csv"
          : "text"
      : format;

  if (detectedFormat === "json") {
    const values: string[] = [];
    const parsed = JSON.parse(raw);
    const selected = jsonPath ? selectJsonPath(parsed, jsonPath) : [parsed];
    if (jsonPath && selected.length === 0) {
      throw new Error(`JSON path “${jsonPath}” did not match any values.`);
    }
    selected.forEach((value) => flattenJson(value, values));
    return values;
  }

  if (detectedFormat === "csv") {
    return parseCsv(raw).flat();
  }

  return raw.split(/\r?\n/);
}

export function normalizeEntries(
  raw: string,
  type: EdlType,
  format: SourceFormat,
  jsonPath = "",
) {
  const normalize =
    type === "ip"
      ? normalizeIp
      : type === "domain"
        ? normalizeDomain
        : normalizeUrlEntry;
  const entries = new Set<string>();

  for (const line of extractCandidates(raw, format, jsonPath)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }

    const normalized = normalize(stripInlineComment(trimmed));
    if (normalized) entries.add(normalized);
  }

  return [...entries].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
}

export function aggregateEntries(
  includeSources: string[][],
  excludeSources: string[][],
) {
  const included = new Set(includeSources.flat());
  const excluded = new Set(excludeSources.flat());
  const entries = [...included].filter((entry) => !excluded.has(entry));

  return {
    entries: entries.sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    ),
    excludedCount: [...included].filter((entry) => excluded.has(entry)).length,
    duplicateCount:
      includeSources.reduce((total, source) => total + source.length, 0) -
      included.size,
  };
}

export function assertSafeSourceUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS source URLs are supported.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal" ||
    hostname === "instance-data.ec2.internal" ||
    hostname === "169.254.169.254" ||
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:") ||
    PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(hostname))
  ) {
    throw new Error("Private, local, and metadata endpoints are not allowed.");
  }

  return url;
}

export async function downloadSource(
  urlValue: string,
  options: {
    headers?: Record<string, string>;
    maxBytes?: number;
  } = {},
) {
  const url = assertSafeSourceUrl(urlValue);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SOURCE_BYTES;
  const response = await fetch(url, {
    headers: {
      accept: "text/plain, application/json, text/csv;q=0.9, */*;q=0.5",
      "user-agent": "OpenEDL/0.1 (+https://github.com/openedl)",
      ...options.headers,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Upstream returned HTTP ${response.status}.`);
  }

  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maxBytes) {
    throw new Error(
      `Source is larger than the ${maxBytes / 1_000_000} MB safety limit.`,
    );
  }

  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new Error(
      `Source is larger than the ${maxBytes / 1_000_000} MB safety limit.`,
    );
  }

  return body;
}

export function parseCachedEntries(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export function relativeTime(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const seconds = Math.max(
    0,
    Math.round((Date.now() - date.getTime()) / 1000),
  );
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
