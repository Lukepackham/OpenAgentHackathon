/**
 * Application links are stored in one comparable form, and the checker
 * refuses addresses that point at this computer or a private network.
 */

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gh_src",
  "fbclid",
  "gclid",
]);

export function canonicalUrl(input) {
  const url = new URL(input);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function safeCanonicalUrl(input) {
  try {
    return canonicalUrl(input);
  } catch {
    return "";
  }
}

/** Empty string means the link may be checked. Any other string is the reason it will not be. */
export function blockedUrlReason(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return "The application link is not a valid URL.";
  }
  if (url.protocol !== "https:") return "The application link must use https.";
  if (url.username || url.password) return "The application link must not contain a username or password.";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") {
    return "The application link points at this computer.";
  }
  if (isPrivateAddress(host)) return "The application link points at a private network.";
  return "";
}

function isPrivateAddress(host) {
  if (host.includes(":")) {
    return host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd");
  }
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
