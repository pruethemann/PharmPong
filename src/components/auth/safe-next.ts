/**
 * Return `next` only when it is a safe same-origin relative path, else the fallback.
 * Rejects protocol-relative ("//evil"), backslash tricks ("/\evil") and control characters.
 */
export function safeNext(next: string | string[] | null | undefined, fallback = "/"): string {
  const v = Array.isArray(next) ? next[0] : next;
  if (typeof v !== "string" || v.length === 0 || v.length > 512) return fallback;
  if (!v.startsWith("/") || v.startsWith("//")) return fallback;
  if (v.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(v)) return fallback;
  return v;
}
