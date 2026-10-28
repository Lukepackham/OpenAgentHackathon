/**
 * An HTTP success means the link responded. It does not mean the vacancy is open.
 * verification_status is left untouched.
 */
import { blockedUrlReason } from "./urls.js";

export async function checkApplicationUrl(url, fetchImpl, timeoutMs = 5000) {
  const blocked = blockedUrlReason(url);
  if (blocked) return { url_status: "unreachable", detail: blocked };

  let current = url;
  try {
    for (let hop = 0; hop < 4; hop += 1) {
      const hopBlocked = blockedUrlReason(current);
      if (hopBlocked) return { url_status: "unreachable", detail: hopBlocked };
      const response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "text/html,application/json" },
      });
      await response.body?.cancel?.();
      if (response.status >= 200 && response.status < 300) return { url_status: "accessible" };
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.("location");
        if (!location) return { url_status: "unreachable", detail: `HTTP ${response.status}` };
        current = new URL(location, current).href;
        continue;
      }
      return { url_status: "unreachable", detail: `HTTP ${response.status}` };
    }
    return { url_status: "unreachable", detail: "too many redirects" };
  } catch (error) {
    const detail = error?.name === "TimeoutError" ? "timed out" : "request failed";
    return { url_status: "unreachable", detail };
  }
}

export async function checkApplicationUrls(candidates, fetchImpl, limit = 20) {
  const checked = [];
  let performed = 0;
  for (const candidate of candidates) {
    if (performed >= limit) {
      checked.push({ ...candidate, url_status: "not_checked" });
      continue;
    }
    performed += 1;
    const result = await checkApplicationUrl(candidate.url, fetchImpl);
    checked.push({ ...candidate, url_status: result.url_status });
  }
  return {
    candidates: checked,
    url_checks: performed,
    url_checks_skipped: Math.max(0, candidates.length - performed),
  };
}
