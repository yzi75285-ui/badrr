import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function newId(prefix: string): string {
  const bytes = randomBytes(16);
  let n = BigInt(`0x${bytes.toString("hex")}`);
  const chars = Array<string>(26);
  for (let i = 25; i >= 0; i -= 1) {
    chars[i] = ALPHABET[Number(n & 31n)] ?? "0";
    n >>= 5n;
  }
  return `${prefix}_${chars.join("")}`;
}

export function newToken(): string {
  return randomBytes(24).toString("hex");
}

const ID_BODY = "[0-9a-hjkmnp-tv-z]{26}";

export function isId(value: string, prefix: string): boolean {
  return new RegExp(`^${prefix}_${ID_BODY}$`).test(value);
}
