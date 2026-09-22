import { AUDIT_OPERATION_RECIPES } from '@isaiandco/ape-share-core/settings/operation-recipes';
import { detectEventPlatform } from "@isaiandco/ape-share-core/filters/platform";
import { searchOperationPage, pidTextValues } from '@isaiandco/ape-share-core/graph/operation-search';
import { migrateOperationProfiles } from '@isaiandco/ape-share-core/settings/operation-profiles';
import { andPredicates, orPredicates, buildEqualityPredicate, buildInPredicate } from '../../shared/pdql/builder.js';
import { normalizeProcessEvent } from './graph.js';
import { parseSiemTime } from '../../shared/time.js';
const SYSMON_OPERATION_PROFILES = [
  ['files', '11, 2, 15, 23, 26', 'object.fullpath'], ['network', '3', 'dst.ip'],
  ['dns', '22', 'object.name'], ['registry', '12, 13, 14', 'object.fullpath'],
  ['access', '8, 10', 'object.process.name'], ['modules', '7', 'object.fullpath'],
].map(([category, eventValues, target]) => ({
  id: `sysmon-${category}`, name: `Sysmon: ${category}`, category, platform: 'windows', enabled: false,
  sourceField: 'event_src.title', sourceValues: 'sysmon', eventField: 'msgid', eventValues,
  host: 'event_src.host', pid: 'subject.process.id', guid: 'subject.process.guid', target,
  targetPort: category === 'network' ? 'dst.port' : '', targetPid: category === 'access' ? 'object.process.id' : '',
  protocol: category === 'network' ? 'protocol' : '', recordId: 'uuid', time: 'time',
}));
export const DEFAULT_OPERATION_PROFILES = [...SYSMON_OPERATION_PROFILES, ...AUDIT_OPERATION_RECIPES.map(recipe => ({
  ...recipe, enabled: false,
  sourceField: 'event_src.title', sourceValues: recipe.platform === 'unix' ? 'auditd' : 'Microsoft-Windows-Security-Auditing',
  eventField: 'msgid', host: 'event_src.host', pid: 'subject.process.id', guid: '',
  // Source titles, msgid, syscall and ObjectType normalization depend on the
  // installed expertise package; require explicit verified mapping.
  operationField: '',
  target: recipe.category === 'network' ? 'dst.ip' : recipe.category === 'access' ? 'object.process.id' : 'object.fullpath',
  targetPort: recipe.category === 'network' ? 'dst.port' : '', targetPid: '',
  protocol: recipe.category === 'network' ? 'protocol' : '', action: 'action', outcome: 'status', targetDetail: '', recordId: 'uuid', time: 'time',
}))];
export function processOperationIdentity(event) {
  const fact = normalizeProcessEvent(event);
  const pid = fact.references.find(ref => ref.kind === 'pid')?.value;
  const guid = fact.references.find(ref => ref.kind === 'guid')?.value;
  const detected = detectEventPlatform({ os: ['event_src.os', 'event_src.os.name', 'host.os.name'].map(field => event[field]),
    source: ['event_src.product', 'event_src.subsys', 'event_src.vendor'].map(field => event[field]),
    paths: ['object.process.path', 'subject.process.path', 'object.process.fullpath', 'subject.process.fullpath', 'object.path'].map(field => event[field]) });
  return { host: fact.host, pid, guid, time: fact.time,
    platform: detected !== 'unknown' ? detected : /execve/i.test(String(event.msgid)) ? 'unix' : String(event.msgid) === '4688' ? 'windows' : 'unknown' };
}
export async function searchMpOperations(input, { client, profiles: saved, scope = {} }) {
  const profiles = migrateOperationProfiles(saved, DEFAULT_OPERATION_PROFILES).profiles;
  return searchOperationPage({ ...input, profiles,
    dialect: { equal: buildEqualityPredicate, in: buildInPredicate, and: values => andPredicates(values),
      factual: 'correlation_name = null',
      guid: (field, value) => orPredicates([...new Set([value, value.toUpperCase(), `{${value}}`, `{${value.toUpperCase()}}`])].map(guid => buildEqualityPredicate(field, guid))),
      pid: (field, value, format) => format === 'text' ? buildInPredicate(field, pidTextValues(value)) : buildEqualityPredicate(field, /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : value) },
    isFact: event => !event.correlation_name,
    read: (event, field) => event[field] ?? '', parseTime: value => parseSiemTime(value)?.valueOf() ?? NaN,
    async fetch({ where, profile, offset, limit, from, to }) {
      const select = [...new Set(['uuid', 'time', 'correlation_name', ...['sourceField', 'eventField', 'operationField', 'host', 'pid', 'guid', 'target', 'targetPort', 'targetPid', 'protocol', 'action', 'outcome', 'targetDetail', 'recordId', 'time'].map(key => profile[key]).filter(Boolean)])];
      const response = await client.searchEvents({ where, select, offset, limit, timeFrom: new Date(from).toISOString(), timeTo: new Date(to).toISOString(), scope,
        orderBy: [{ field: profile.time, sortOrder: 'ascending' }, { field: profile.recordId, sortOrder: 'ascending' }] });
      const events = Array.isArray(response) ? response : response?.events;
      if (!Array.isArray(events)) throw new Error('MP SIEM вернула неизвестный формат событий');
      return events;
    },
  });
}
