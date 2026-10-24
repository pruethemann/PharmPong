import { hash, verify } from "@node-rs/argon2";

// OWASP baseline for Argon2id: m=19 MiB, t=2, p=1.
const OPTIONS = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Burn comparable CPU for unknown users so response time does not reveal which accounts exist. */
export async function verifyDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword("pharmapong-dummy-password");
  await verifyPassword(await dummyHash, password);
}
