import { describe, expect, it } from "vitest";
import { extractHashes, extractPreferredHash } from "../src/shared/hash.js";

const md5 = "a".repeat(32);
const sha1 = "b".repeat(40);
const sha256 = "c".repeat(64);

describe("MaxPatrol hash extraction", () => {
  it.each([[md5, "md5"], [sha1, "sha1"], [sha256, "sha256"]])("extracts a bare %s", (value, key) => expect(extractHashes(value)[key]).toBe(value));
  it("extracts combined, uppercase and whitespace representation", () => {
    expect(extractHashes(` SHA256: ${sha256.toUpperCase()}  SHA1:${sha1} MD5: ${md5} `)).toEqual({ sha256, sha1, md5 });
    expect(extractPreferredHash(`MD5:${md5} SHA1:${sha1}`)).toBe(sha1);
  });
  it("rejects malformed values", () => expect(extractHashes("SHA1: nope")).toEqual({}));
});
