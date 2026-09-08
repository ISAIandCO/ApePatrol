import { compareEvents as compare } from "./core/event-compare.js";
export { normalizeCompareFieldName, eventDiffToMarkdown } from "./core/event-compare.js";

const GROUPS = Object.freeze([
  ["process", /(^|\.)(process|cmdline|executable|image|pid|ppid|hash)(\.|$)/i],
  ["network", /(^|\.)(src|dst|source|destination|ip|port|domain|url|dns|protocol)(\.|$)/i],
  ["account", /(^|\.)(account|user|subject)(\.|$)/i],
  ["host", /(^|\.)(host|hostname|asset)(\.|$)/i],
  ["rule", /(rule|correlation|incident|severity|category)/i],
]);

export function compareFieldGroup(field) {
  return GROUPS.find(([, pattern]) => pattern.test(field))?.[0] ?? "raw";
}

export function compareEvents(events) { return compare(events, { fieldGroup: compareFieldGroup }); }
