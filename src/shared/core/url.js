const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

export function parseSafeExternalUrl(value, base) {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (!SAFE_PROTOCOLS.has(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function normalizeOrigin(value) {
  const url = parseSafeExternalUrl(value);
  if (!url || url.pathname !== "/" || url.search || url.hash) return null;
  return url.origin;
}

export function originPattern(origin) {
  const normalized = normalizeOrigin(origin);
  return normalized ? `${normalized}/*` : null;
}

export function fillUrlTemplate(template, values) {
  if (typeof template !== "string") return null;
  const rendered = template.replace(/\$\{([a-z]+)\}/gi, (_match, key) => {
    const value = values[key.toLowerCase()];
    return value === undefined ? "" : encodeURIComponent(String(value));
  });
  return parseSafeExternalUrl(rendered);
}

export function sanitizeFilenamePart(value, fallback = "unknown") {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}
