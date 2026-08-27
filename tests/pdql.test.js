import { describe, expect, it } from "vitest";
import { buildEqualityPredicate, buildInPredicate } from "../src/shared/pdql/builder.js";
import { escapePdqlString, formatPdqlValue } from "../src/shared/pdql/escape.js";

describe("PDQL builder", () => {
  it("escapes quotes and backslashes", () => expect(escapePdqlString("a'b\\c")).toBe("a\\'b\\\\c"));
  it("builds equality for IPv6", () => expect(buildEqualityPredicate("src.ip", "2001:db8::1")).toBe("src.ip = '2001:db8::1'"));
  it("formats arrays, null and numeric types", () => {
    expect(formatPdqlValue(["x", 42, null])).toBe("['x', 42, null]");
    expect(formatPdqlValue(true)).toBe("true");
  });
  it("builds IN without raw interpolation", () => expect(buildInPredicate("msgid", ["1", "4688"])).toBe("msgid in ['1', '4688']"));
  it("rejects invalid fields and non-finite values", () => {
    expect(() => buildEqualityPredicate("src.ip or true", "x")).toThrow();
    expect(() => formatPdqlValue(Infinity)).toThrow();
  });
});
