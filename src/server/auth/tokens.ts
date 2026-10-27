import { createHash, randomBytes, randomInt } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Crockford base32 without I, L, O, U: unambiguous when read aloud at a party.
const INVITE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function inviteCode(length = 8): string {
  let out = "";
  for (let i = 0; i < length; i++) out += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return out;
}

export function normalizeInviteCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

// Lowercase without the look-alikes i, l, o, 0 and 1: easy to type on a phone.
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Generated one-time password: four groups of five characters (about 99 bits), e.g. "k7m2q-xp4rt-9wbzc-h3fna". */
export function oneTimePassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = "";
    for (let i = 0; i < 5; i++) group += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}
