import { timingSafeEqual } from "node:crypto";

export function tokensMatch(stored: string, given: string): boolean {
  const left = Buffer.from(stored);
  const right = Buffer.from(given);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function scrub(message: string, roots: string[]): string {
  let text = message;
  for (const root of roots) {
    if (!root) continue;
    const variants = new Set([root, root.replaceAll("\\", "/"), root.replaceAll("/", "\\")]);
    for (const variant of variants) {
      if (variant) text = text.split(variant).join("[路径]");
    }
  }
  return text.replace(/\s+/g, " ").trim();
}

export function failure(code: string, message: string, roots: string[]): { code: string; message: string } {
  let text = scrub(message, roots);
  if (text.length > 500) text = `${text.slice(0, 497)}...`;
  if (!text) text = "预处理失败。";
  return { code: code.slice(0, 64), message: text };
}
