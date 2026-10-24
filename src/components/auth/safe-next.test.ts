import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("accepts relative paths", () => {
    expect(safeNext("/team")).toBe("/team");
    expect(safeNext("/team/join?code=ABC")).toBe("/team/join?code=ABC");
  });

  it("rejects external and tricky targets", () => {
    for (const bad of [
      "//evil.com",
      "https://evil.com",
      "evil.com",
      "/\\evil.com",
      "/\tevil",
      "",
      undefined,
      null,
    ]) {
      expect(safeNext(bad)).toBe("/");
    }
  });

  it("uses the fallback and the first array entry", () => {
    expect(safeNext("//x", "/team")).toBe("/team");
    expect(safeNext(["/a", "/b"])).toBe("/a");
  });
});
