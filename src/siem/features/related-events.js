import { andPredicates, buildEqualityPredicate, buildInPredicate, orPredicates } from "../../shared/pdql/builder.js";
import { toEpochSeconds } from "../../shared/time.js";

const TIME_PRESETS = Object.freeze({ "5m": 300, "15m": 900, "1h": 3600, "24h": 86400, "7d": 604800, "30d": 2592000 });

export function buildRelatedEventActions(event) {
  const actions = [];
  const host = event["event_src.host"];
  const account = event["subject.account.name"] ?? event["object.account.name"];
  const ips = [...new Set([event["src.ip"], event["dst.ip"]].filter(Boolean))];
  const guid = event["object.process.guid"] ?? event["subject.process.guid"];
  const hash = event["object.hash"];
  const executable = event["object.process.name"];
  if (host) {
    actions.push({ group: "Host", label: "All events on host", where: buildEqualityPredicate("event_src.host", host) });
    actions.push({ group: "Host", label: "Process starts", where: andPredicates(buildEqualityPredicate("event_src.host", host), buildInPredicate("msgid", ["1", "4688", "execve"])) });
    actions.push({ group: "Host", label: "Authentication events", where: andPredicates(buildEqualityPredicate("event_src.host", host), orPredicates("subject = 'account'", "object = 'account'")) });
  }
  if (account) actions.push({ group: "Account", label: "Account activity", where: orPredicates(buildEqualityPredicate("subject.account.name", account), buildEqualityPredicate("object.account.name", account)) });
  for (const ip of ips) actions.push({ group: "IP", label: `Events involving ${ip}`, where: orPredicates(buildEqualityPredicate("src.ip", ip), buildEqualityPredicate("dst.ip", ip)) });
  if (guid) actions.push({ group: "Process", label: "Same process GUID", where: orPredicates(buildEqualityPredicate("object.process.guid", guid), buildEqualityPredicate("subject.process.guid", guid)) });
  if (hash) actions.push({ group: "Process", label: "Same hash", where: buildEqualityPredicate("object.hash", hash) });
  if (executable) actions.push({ group: "Process", label: "Same executable", where: buildEqualityPredicate("object.process.name", executable) });
  return actions;
}

export function buildEventSearchUrl(origin, where, eventTime, preset = "15m") {
  const center = (toEpochSeconds(eventTime) ?? Math.floor(Date.now() / 1000)) * 1000;
  const range = (TIME_PRESETS[preset] ?? TIME_PRESETS["15m"]) * 1000;
  const search = new URLSearchParams({
    where,
    period: "range",
    start: String(center - range),
    end: String(center + range),
  });
  return new URL(`/#/events/view?${search}`, origin).href;
}

export function resolveAiRelatedRequest(event, input = {}) {
  const relation = ["host", "account", "ip", "process"].includes(input.relation) ? input.relation : null;
  if (!relation) throw new TypeError("Unknown related-event relation");
  const action = buildRelatedEventActions(event).find((item) => item.group.toLowerCase() === relation);
  if (!action) throw new Error(`Current event has no ${relation} relation`);
  return {
    relation,
    range: Object.hasOwn(TIME_PRESETS, input.range) ? input.range : "15m",
    limit: Math.max(1, Math.min(25, Number(input.limit) || 25)),
    action,
  };
}

export { TIME_PRESETS };
