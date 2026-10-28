import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = 0;
let lastRandom = 0n;

/** Monotonic ULID. The time prefix sorts contracts in issue order. */
export function ulid(now = Date.now()) {
  let time = now;
  let random = BigInt("0x" + randomBytes(10).toString("hex"));
  if (time === lastTime) {
    random = lastRandom + 1n;
  }
  lastTime = time;
  lastRandom = random;

  let timePart = "";
  for (let i = 0; i < 10; i++) {
    timePart = ALPHABET[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  let randPart = "";
  for (let i = 0; i < 16; i++) {
    randPart = ALPHABET[Number(random & 31n)] + randPart;
    random >>= 5n;
  }
  return timePart + randPart;
}

export function traceId() {
  return randomBytes(16).toString("hex");
}

/** Sorted-key JSON. The signature covers this exact string, without the signature field. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function signBody(secret, value) {
  return createHmac("sha256", secret).update(canonicalJson(value)).digest("hex");
}

export function issueContract(fields, secret) {
  const unsigned = { ...fields, signedBy: "scout" };
  return { ...unsigned, signature: signBody(secret, unsigned) };
}

export function verifyContract(contract, secret, now = Date.now()) {
  if (!contract || typeof contract !== "object") return { ok: false, reason: "unsigned" };
  if (contract.signedBy !== "scout" || typeof contract.signature !== "string") {
    return { ok: false, reason: "unsigned" };
  }
  const { signature, ...rest } = contract;
  const expected = signBody(secret, rest);
  const actualBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return { ok: false, reason: "bad-signature" };
  }
  if (!contract.expiresAt || Date.parse(contract.expiresAt) <= now) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

/**
 * Run a signed contract. Downstream code calls this instead of trusting the
 * raw prompt. Unsigned, expired, unapproved, and out-of-scope calls are refused.
 */
export function executeContract(contract, secret, handlers, ctx = {}) {
  const verdict = verifyContract(contract, secret);
  const record = (name, fields) => ctx.telemetry?.record(name, fields);
  if (!verdict.ok) {
    record("contract.refused", { contractId: contract?.contractId, engine: ctx.engine, reason: verdict.reason });
    return { ok: false, refused: true, reason: verdict.reason, outputs: [] };
  }

  const required = contract.risk?.approvalsRequired ?? [];
  const granted = contract.risk?.approvals ?? [];
  if (required.length > granted.length) {
    record("contract.refused", { contractId: contract.contractId, engine: ctx.engine, reason: "approval-missing" });
    return { ok: false, refused: true, reason: "approval-missing", outputs: [] };
  }

  record("contract.verified", { contractId: contract.contractId, engine: ctx.engine ?? "executor", verified: true });
  const allowed = new Set(contract.scope?.capabilities ?? []);
  const outputs = [];
  for (const step of contract.toolPlan ?? []) {
    if (!allowed.has(step.capability)) {
      record("contract.refused", { contractId: contract.contractId, engine: ctx.engine, reason: "scope-mismatch" });
      return { ok: false, refused: true, reason: "scope-mismatch", outputs };
    }
    const handler = handlers[step.capability];
    if (!handler) {
      record("contract.refused", {
        contractId: contract.contractId,
        engine: ctx.engine,
        reason: "unresolved-tool",
      });
      return { ok: false, refused: true, reason: `unresolved-tool:${step.capability}`, outputs };
    }
    outputs.push({ capability: step.capability, tool: step.tool, output: handler(step.input, ctx) });
  }
  return { ok: true, refused: false, outputs };
}
