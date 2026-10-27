import { describe, expect, it } from "vitest";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import pirate from "../../messages/pirate.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? { ...acc, [path]: value } : { ...acc, ...flatten(value, path) };
  }, {});
}

/** ICU argument names used in a message, e.g. "{count, plural, ...}" -> "count". */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z_][\w]*)\s*[,}]/g)].map((m) => m[1]).sort();
}

const base = flatten(en as Tree);

describe.each([
  ["de", de],
  ["pirate", pirate],
] as const)("%s catalogue", (_name, catalogue) => {
  const flat = flatten(catalogue as Tree);

  it("has exactly the keys of en.json", () => {
    expect(Object.keys(flat).sort()).toEqual(Object.keys(base).sort());
  });

  it("uses the same ICU placeholders as en.json", () => {
    for (const [key, message] of Object.entries(base)) {
      expect(placeholders(flat[key] ?? ""), key).toEqual(placeholders(message));
    }
  });
});
