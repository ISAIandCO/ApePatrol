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
  // MP normalizes Security ObjectType into object.type. Audit syscall names
  // have no uniform field across expertise packages and remain draft mappings.
  operationField: recipe.id.startsWith('security-') && recipe.selectorRequired ? 'object.type' : '',
  operationValues: recipe.id === 'security-files' ? 'file' : recipe.id === 'security-registry-access' ? 'registry_key' : recipe.id === 'security-access' ? 'process' : recipe.operationValues,
  target: recipe.category === 'network' ? 'dst.ip' : recipe.category === 'access' ? 'object.process.id' : 'object.fullpath',
  targetPort: recipe.category === 'network' ? 'dst.port' : '', targetPid: '',
  protocol: recipe.category === 'network' ? 'protocol' : '', action: 'action', outcome: 'status', targetDetail: '', recordId: 'uuid', time: 'time',
}))];
export function migrateMpOperationProfiles(saved) {
  // Repair only untouched incomplete Security templates from 3.4.26. Keep all
  // explicit classifier mappings/values and enabled flags chosen by the user.
  const repair = profile => {
    const recommended = DEFAULT_OPERATION_PROFILES.find(item => item.id === profile.id);
    const original = AUDIT_OPERATION_RECIPES.find(item => item.id === profile.id);
    if (recommended?.operationField && !profile.operationField && profile.operationValues === original?.operationValues) {
      return { ...profile, operationField: recommended.operationField, operationValues: recommended.operationValues };
    }
    return profile;
  };
  const value = Array.isArray(saved) ? saved.map(repair) : saved?.version === 1 ? { ...saved, profiles: saved.profiles.map(repair) } : saved;
  return migrateOperationProfiles(value, DEFAULT_OPERATION_PROFILES);
}
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
// Use the installation's schema just as the existing process graph does. Optional
// shipped fields can be absent in older schemas; custom mappings must not be
// silently replaced. Required unavailable fields fail locally, before POST.
export function resolveOperationProfiles(profiles, metadata) {
  if (!Array.isArray(metadata?.fields) || !metadata.fields.length) throw new Error('MP SIEM не вернула схему полей. Повторите запрос после проверки доступа к метаданным событий.');
  const available = new Set(metadata.fields.filter(field => field.filterable !== false).map(field => field.name));
  available.add('time');
  const optional = ['guid', 'targetPort', 'targetPid', 'protocol', 'action', 'outcome', 'targetDetail'];
  return profiles.map(profile => {
    const result = { ...profile };
    const shipped = DEFAULT_OPERATION_PROFILES.find(item => item.id === profile.id);
    if (shipped && result.target === 'object.fullpath' && !available.has(result.target) && available.has('object.path')) {
      result.target = 'object.path';
      if (!result.targetDetail && available.has('object.name')) result.targetDetail = 'object.name';
    }
    for (const key of optional) {
      if (result[key] && !available.has(result[key]) && shipped?.[key] === result[key]) result[key] = '';
    }
    const keys = ['sourceField', 'eventField', 'operationField', 'host', 'pid', 'target', 'recordId', 'time', ...optional];
    const missing = [...new Set(keys.map(key => result[key]).filter(field => field && !available.has(field)))];
    if (!available.has('correlation_name')) missing.push('correlation_name');
    if (missing.length) throw new Error(`${profile.name || profile.id}: в схеме MP SIEM отсутствуют поля ${missing.join(', ')}. Проверьте сопоставления этого профиля.`);
    return result;
  });
}
export async function searchMpOperations(input, { client, profiles: saved, scope = {} }) {
  let profiles = migrateMpOperationProfiles(saved).profiles.filter(profile => profile.enabled && profile.platform === input.process.platform && profile.category === input.category);
  if (profiles.length) profiles = resolveOperationProfiles(profiles, await client.getEventMetadata());
  return searchOperationPage({ ...input, profiles,
    dialect: { equal: buildEqualityPredicate, in: buildInPredicate, and: values => andPredicates(values),
      factual: 'correlation_name = null',
      guid: (field, value) => orPredicates([...new Set([value, value.toUpperCase(), `{${value}}`, `{${value.toUpperCase()}}`])].map(guid => buildEqualityPredicate(field, guid))),
      pid: (field, value, format) => format === 'text' ? buildInPredicate(field, pidTextValues(value)) : buildEqualityPredicate(field, /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : value) },
    isFact: event => !event.correlation_name,
    read: (event, field) => event[field] ?? '', parseTime: value => parseSiemTime(value)?.valueOf() ?? NaN,
    async fetch({ where, profile, offset, limit, from, to }) {
      const select = [...new Set(['correlation_name', ...['sourceField', 'eventField', 'operationField', 'host', 'pid', 'guid', 'target', 'targetPort', 'targetPid', 'protocol', 'action', 'outcome', 'targetDetail', 'recordId', 'time'].map(key => profile[key]).filter(Boolean)])];
      const response = await client.searchEvents({ where, select, offset, limit, timeFrom: new Date(from).toISOString(), timeTo: new Date(to).toISOString(), scope,
        orderBy: [{ field: profile.time, sortOrder: 'ascending' }, { field: profile.recordId, sortOrder: 'ascending' }] });
      const events = Array.isArray(response) ? response : response?.events;
      if (!Array.isArray(events)) throw new Error('MP SIEM вернула неизвестный формат событий');
      return events;
    },
  });
}
