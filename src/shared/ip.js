function ipv4Number(value) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((number, part) => (number << 8n) | BigInt(part), 0n);
}

function inV4(value, base, bits) {
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(32 - bits);
  return (value & mask) === (ipv4Number(base) & mask);
}

function ipv6Number(value) {
  let input = value.toLowerCase();
  if ((input.match(/::/g) ?? []).length > 1) return null;
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    const v4 = ipv4Number(input.slice(lastColon + 1));
    if (v4 === null) return null;
    input = `${input.slice(0, lastColon)}:${((v4 >> 16n) & 0xffffn).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [leftText, rightText] = input.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  if ([...left, ...right].some((part) => !/^[a-f\d]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((input.includes("::") && missing < 1) || (!input.includes("::") && missing !== 0)) return null;
  const parts = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right];
  return parts.reduce((number, part) => (number << 16n) | BigInt(`0x${part}`), 0n);
}

function inV6(value, base, bits) {
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (value & mask) === (ipv6Number(base) & mask);
}

export function classifyIp(value) {
  if (typeof value !== "string") return "invalid";
  const v4 = ipv4Number(value);
  if (v4 !== null) {
    if (inV4(v4, "10.0.0.0", 8) || inV4(v4, "172.16.0.0", 12) || inV4(v4, "192.168.0.0", 16)) return "private";
    if (inV4(v4, "127.0.0.0", 8)) return "loopback";
    if (inV4(v4, "169.254.0.0", 16)) return "link-local";
    if (inV4(v4, "224.0.0.0", 4)) return "multicast";
    if (inV4(v4, "0.0.0.0", 8) || inV4(v4, "100.64.0.0", 10) || inV4(v4, "192.0.2.0", 24)
      || inV4(v4, "198.51.100.0", 24) || inV4(v4, "203.0.113.0", 24) || inV4(v4, "240.0.0.0", 4)) return "reserved";
    return "public";
  }
  const v6 = ipv6Number(value);
  if (v6 === null) return "invalid";
  if (v6 === 0n) return "reserved";
  if (v6 === 1n) return "loopback";
  if (inV6(v6, "fc00::", 7)) return "private";
  if (inV6(v6, "fe80::", 10)) return "link-local";
  if (inV6(v6, "ff00::", 8)) return "multicast";
  if (inV6(v6, "2001:db8::", 32)) return "reserved";
  return "public";
}
