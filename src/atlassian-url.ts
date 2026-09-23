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

export interface AtlassianUrlOptions {
  /**
   * Exact extra host from `ATLASSIAN_ALLOW_HOST`.
   * Link-local, loopback, metadata, and IP addresses stay refused even when this is set.
   */
  allowHost?: string;
}

/**
 * Validate a configured Confluence or Jira base URL.
 * https only, no userinfo. `*.atlassian.net` is allowlisted.
 * Any other DNS host is accepted only when it matches `allowHost`.
 */
export function assertConfiguredBaseUrl(raw: string, options: AtlassianUrlOptions = {}): URL {
  const url = parseHttps(raw);
  const host = normalizeHost(url.hostname);
  if (isDangerousHost(host)) {
    throw new Error(`Refusing link-local, loopback, metadata, or private host: ${host}`);
  }
  if (isAtlassianCloudHost(host)) {
    return url;
  }
  const allow = options.allowHost ? normalizeHost(options.allowHost) : undefined;
  if (allow && host === allow) {
    return url;
  }
  throw new Error(`Refusing host ${host}; expected *.atlassian.net or the host named by ATLASSIAN_ALLOW_HOST`);
}

/** A request target must stay on `*.atlassian.net` or the exact configured host. */
export function assertAtlassianRequestUrl(raw: string, configuredHost: string): string {
  const url = parseHttps(raw);
  const host = normalizeHost(url.hostname);
  if (isDangerousHost(host)) {
    throw new Error(`Refusing link-local, loopback, metadata, or private host: ${host}`);
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
 * Fetch with `redirect: "error"`. A 3xx response is a failure; the Location is not followed.
 */
export async function fetchAtlassian(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  configuredHost: string,
): Promise<Response> {
  const current = assertAtlassianRequestUrl(url, configuredHost);
  const response = await fetchImpl(current, { ...init, redirect: "error" });
  if (REDIRECT_STATUSES.has(response.status)) {
    await discardBody(response);
    throw new Error("Refusing an Atlassian redirect (redirect mode is error)");
  }
  return response;
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
