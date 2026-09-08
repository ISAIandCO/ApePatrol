const HASH_LENGTHS = Object.freeze({ md5: 32, sha1: 40, sha256: 64 });

export function extractHashes(value) {
  if (typeof value !== "string") return {};
  const result = {};
  const labelled = /\b(SHA(?:-?1|-?256)|MD5)\s*:\s*([a-f\d]+)\b/gi;
  for (const match of value.matchAll(labelled)) {
    const algorithm = match[1].replace("-", "").toLowerCase();
    const hash = match[2].toLowerCase();
    if (hash.length === HASH_LENGTHS[algorithm]) result[algorithm] = hash;
  }
  const trimmed = value.trim().toLowerCase();
  if (/^[a-f\d]+$/.test(trimmed)) {
    const algorithm = Object.keys(HASH_LENGTHS).find((name) => HASH_LENGTHS[name] === trimmed.length);
    if (algorithm) result[algorithm] = trimmed;
  }
  return result;
}

export function extractPreferredHash(value) {
  const hashes = extractHashes(value);
  return hashes.sha256 ?? hashes.sha1 ?? hashes.md5 ?? null;
}
