import { describe, expect, it } from "vitest";
import { iocFromField, normalizeIoc } from "../src/shared/ioc.js";

describe("IOC normalization", () => {
  it("recognizes common SIEM fields", () => {
    expect(iocFromField("src.ip", "8.8.8.8")).toEqual({ type: "ip", value: "8.8.8.8" });
    expect(iocFromField("dst.domain", "Example.COM")).toEqual({ type: "domain", value: "example.com" });
    expect(iocFromField("object.url", "https://example.com/a")).toEqual({ type: "url", value: "https://example.com/a" });
    expect(iocFromField("object.hash", "MD5: d41d8cd98f00b204e9800998ecf8427e")).toEqual({ type: "hash", value: "d41d8cd98f00b204e9800998ecf8427e" });
  });

  it("rejects invalid or unsafe IOC values", () => {
    expect(normalizeIoc("url", "javascript:alert(1)")).toBeNull();
    expect(normalizeIoc("domain", "not a domain")).toBeNull();
    expect(normalizeIoc("ip", "999.1.1.1")).toBeNull();
  });
});
