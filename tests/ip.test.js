import { describe, expect, it } from "vitest";
import { classifyIp } from "../src/shared/ip.js";

describe("IP classification", () => {
  it.each([
    ["8.8.8.8", "public"], ["10.0.0.1", "private"], ["172.31.1.1", "private"], ["127.0.0.1", "loopback"],
    ["169.254.1.1", "link-local"], ["239.1.1.1", "multicast"], ["192.0.2.1", "reserved"],
    ["2001:4860:4860::8888", "public"], ["fd00::1", "private"], ["::1", "loopback"], ["fe80::1", "link-local"],
    ["ff02::1", "multicast"], ["2001:db8::1", "reserved"], ["bad ip", "invalid"], ["999.1.1.1", "invalid"],
  ])("classifies %s as %s", (value, expected) => expect(classifyIp(value)).toBe(expected));
});
