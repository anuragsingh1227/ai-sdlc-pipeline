const METADATA_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
  "instance-data.ec2.internal",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

/**
 * Validate a configured Confluence or Jira base URL.
 * https only. `*.atlassian.net` is allowlisted. Any other host is accepted only
 * as this exact configured host, and link-local, loopback, and metadata hosts are refused.
 */
export function assertConfiguredBaseUrl(raw: string): URL {
  const url = parseHttps(raw);
  const host = normalizeHost(url.hostname);
  if (isDangerousHost(host)) {
    throw new Error(`Refusing link-local, loopback, or metadata host: ${host}`);
  }
  if (!isAtlassianCloudHost(host) && !isDnsName(host)) {
    throw new Error(`Refusing host ${host}; expected *.atlassian.net or a configured DNS host`);
  }
  return url;
}

/** A request or redirect target must stay on `*.atlassian.net` or the exact configured host. */
export function assertAtlassianRequestUrl(raw: string, configuredHost: string): string {
  const url = parseHttps(raw);
  const host = normalizeHost(url.hostname);
  if (isDangerousHost(host)) {
    throw new Error(`Refusing link-local, loopback, or metadata host: ${host}`);
  }
  const allowed = host === normalizeHost(configuredHost) || isAtlassianCloudHost(host);
  if (!allowed) {
    throw new Error(`Refusing host ${host}; expected *.atlassian.net or the configured host ${configuredHost}`);
  }
  return url.toString();
}

export function isAtlassianCloudHost(host: string): boolean {
  const normalized = normalizeHost(host);
  const suffix = ".atlassian.net";
  if (!normalized.endsWith(suffix)) {
    return false;
  }
  const prefix = normalized.slice(0, -suffix.length);
  return prefix.length > 0 && !prefix.endsWith(".") && isDnsName(normalized);
}

/**
 * Fetch without following redirects automatically.
 * Each hop must pass the same https and host checks as the original URL.
 */
export async function fetchAtlassian(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  configuredHost: string,
): Promise<Response> {
  let current = assertAtlassianRequestUrl(url, configuredHost);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(current, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }
    if (hop === MAX_REDIRECTS) {
      throw new Error("Too many redirects talking to Atlassian");
    }
    const location = response.headers.get("location");
    await discardBody(response);
    if (!location) {
      throw new Error("Atlassian redirect is missing a Location header");
    }
    current = assertAtlassianRequestUrl(new URL(location, current).toString(), configuredHost);
  }
  throw new Error("Too many redirects talking to Atlassian");
}

function parseHttps(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Refusing URL that is not absolute https: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Refusing non-https Atlassian URL (${url.protocol})`);
  }
  if (url.username || url.password) {
    throw new Error("Refusing Atlassian URL with embedded credentials");
  }
  return url;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, "");
}

function isDnsName(host: string): boolean {
  if (isIpLiteral(host) || !host.includes(".")) {
    return false;
  }
  return /^[a-z0-9.-]+$/.test(host);
}

function isIpLiteral(host: string): boolean {
  return host.startsWith("[") || host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\d+$/.test(host);
}

function isDangerousHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (isIpLiteral(normalized)) {
    return true;
  }
  if (METADATA_HOSTS.has(normalized)) {
    return true;
  }
  if (normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    return true;
  }
  if (normalized.endsWith(".metadata.google.internal") || normalized.includes("169.254.169.254")) {
    return true;
  }
  return false;
}

async function discardBody(response: Response): Promise<void> {
  const body = response.body;
  if (body && typeof body.cancel === "function") {
    await body.cancel();
  }
}
