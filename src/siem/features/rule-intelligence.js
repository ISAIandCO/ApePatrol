function first(source, paths) {
  for (const path of paths) {
    let value = source;
    for (const part of path.split(".")) value = value?.[part];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function strings(value) {
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return value === null || value === undefined || value === "" ? [] : [String(value)];
}

export function buildRuleIntelligence(rule, event = {}, knowledgeBaseUrl = null) {
  if (!rule && !event.correlation_name) return null;
  const explicitMitre = [
    first(rule, ["mitreTechniques", "attackTechniques", "metadata.mitre.techniques", "metadata.attack.techniques"]),
    event["mitre.technique"], event["mitre.technique.id"], event["attack.technique"], event["attack.technique.id"],
  ].flatMap(strings);
  return {
    id: String(first(rule, ["objectId", "id", "uuid", "name"]) ?? event.correlation_name ?? ""),
    name: String(first(rule, ["displayName", "name", "title"]) ?? event.correlation_name ?? "Unknown rule"),
    description: String(first(rule, ["description", "metadata.description"]) ?? event.correlation_description ?? ""),
    categories: [...new Set([
      ...strings(first(rule, ["categories", "category", "metadata.categories"])),
      ...strings(event.category),
    ])].slice(0, 30),
    severity: String(first(rule, ["severity", "level", "metadata.severity"]) ?? event.severity ?? ""),
    knowledgeBaseUrl,
    references: [...new Set(strings(first(rule, ["references", "links", "metadata.references"])))].filter((value) => /^https?:\/\//i.test(value)).slice(0, 20),
    mitreTechniques: [...new Set(explicitMitre)].slice(0, 50),
    mitreSource: explicitMitre.length ? "explicit-siem-metadata" : null,
    metadata: {
      status: first(rule, ["status", "state"]),
      version: first(rule, ["version", "revision"]),
      author: first(rule, ["author", "owner", "metadata.author"]),
    },
  };
}
