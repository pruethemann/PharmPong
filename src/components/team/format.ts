/** "K7Q2M9XA" → "K7Q2-M9XA" for reading aloud. */
export function formatInviteCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
