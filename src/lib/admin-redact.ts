// Strip secret-looking keys from JSON payloads (audit before/after, match event payloads)
// before they reach the admin UI. Pure.

/** Keys that must never leave the server, at any depth. basisHash is a tie fingerprint, not a secret. */
const SECRET_KEY = /password|tokenhash|^token$|secret|^sessionid$|^sessiontoken$|^codehash$/i;

export const REDACTED = "[entfernt]";

/** Deep copy of a JSON value without secret-looking keys. */
export function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 12) return "…";
  if (Array.isArray(value)) return value.map((v) => redactJson(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? REDACTED : redactJson(v, depth + 1);
    }
    return out;
  }
  return value;
}
