import { describe, it, expect, vi } from 'vitest';
import { searchMpOperations, DEFAULT_OPERATION_PROFILES, processOperationIdentity, migrateMpOperationProfiles } from '../src/siem/process/operations.js';
import { normalizeSettings } from '../src/shared/settings.js';
import { SiemApiClient } from '../src/siem/api/client.js';
const metadata = { fields: ['uuid', 'time', 'correlation_name', 'event_src.host', 'event_src.title', 'event_src.provider', 'msgid', 'subject.process.id', 'subject.process.guid', 'object.fullpath', 'object.name', 'object.type', 'object.process.id', 'object.process.name', 'dst.ip', 'dst.port', 'protocol', 'action', 'status', 'datafield1'].map(name => ({ name, filterable: true })) };
const getEventMetadata = async () => metadata;
const from = Date.parse('2026-01-01T00:00:00Z');
const process = { host: 'workstation.example', pid: '42', guid: '', from, to: from + 60000, platform: 'windows' };
const profile = { ...DEFAULT_OPERATION_PROFILES[0], enabled: true };
const event = id => ({ uuid: String(id), time: new Date(from + 1000).toISOString(), 'event_src.host': process.host, 'event_src.title': 'sysmon', msgid: '11', 'subject.process.id': 42, 'object.fullpath': '/example/file' });
describe('MP operation adapter', () => {
  it('pages API by 25 with stable time+uuid ordering and keeps actor separate from target', async () => {
    const requests = [];
    const client = new SiemApiClient('https://siem.example', { fetchImpl: async (url, request) => {
      if (String(url).includes('events_metadata')) return new Response(JSON.stringify(metadata), { status: 200, headers: { 'content-type': 'application/json' } });
      requests.push({ url: String(url), body: JSON.parse(request.body) });
      return new Response(JSON.stringify({ events: Array.from({ length: 25 }, (_, i) => event(i)) }), { status: 200, headers: { 'content-type': 'application/json' } });
    } });
    const options = { client, profiles: [profile] };
    const first = await searchMpOperations({ process, category: 'files' }, options);
    await searchMpOperations({ process, category: 'files', cursor: first.cursor }, options);
    expect(requests[0].url).toContain('limit=25&offset=0'); expect(requests[1].url).toContain('offset=25');
    expect(requests[0].body.filter.orderBy).toEqual([{ field: 'time', sortOrder: 'ascending' }, { field: 'uuid', sortOrder: 'ascending' }]);
    expect(requests[0].body.filter.where).toContain('subject.process.id = 42');
    expect(requests[0].body.filter.where).toContain('correlation_name = null');
    expect(requests[0].body.timeFrom).toBe(from / 1000);
    expect(first.facts[0].label).toBe('/example/file');
  });
  it('preserves enabled custom profiles through settings normalization', () => {
    const settings = normalizeSettings({ operationProfiles: [{ ...profile, pid: 'datafield1' }] });
    expect(settings.operationProfiles.profiles[0].pid).toBe('datafield1');
    expect(normalizeSettings(settings).operationProfiles).toEqual(settings.operationProfiles);
    expect(normalizeSettings({ operationProfiles: [] }).operationProfiles.profiles).toEqual([]);
  });
  it('uses the created process identity rather than creator identity', () => {
    const identity = processOperationIdentity({ uuid: 'source', time: new Date(from).toISOString(), msgid: '4688', 'event_src.host': process.host, 'object.process.id': 42, 'subject.process.id': 99 });
    expect(identity.pid).toBe('42'); expect(identity.platform).toBe('windows');
  });
  it('does not query for unsupported platform and preserves failures', async () => {
    const client = { getEventMetadata, searchEvents: vi.fn(async () => { throw new Error('HTTP 500'); }) };
    const unsupported = await searchMpOperations({ process: { ...process, platform: 'unix' }, category: 'registry' }, { client, profiles: [profile] });
    expect(unsupported.unsupported).toBeTruthy(); expect(client.searchEvents).not.toHaveBeenCalled();
    await expect(searchMpOperations({ process, category: 'files' }, { client, profiles: [profile] })).rejects.toThrow('HTTP 500');
  });
});

it('Windows Security and Linux catalog profiles use verified custom classifier fields in PDQL and parsing', async () => {
  for (const preset of DEFAULT_OPERATION_PROFILES.filter(item => !item.id.startsWith('sysmon-'))) {
    const configured = { ...preset, enabled: true, sourceValues: 'synthetic-source', operationField: preset.selectorRequired ? 'datafield1' : '', target: 'object.name' };
    const record = { uuid: `fixture-${preset.id}`, time: new Date(from + 1000).toISOString(), 'event_src.host': process.host, [configured.sourceField]: 'synthetic-source', msgid: preset.eventValues.split(',')[0].trim(), 'subject.process.id': 42, 'object.process.id': 999, 'object.name': preset.category === 'access' ? '73' : '/example/target', datafield1: preset.operationValues?.split(',')[0].trim(), action: 'read', status: 'success' };
    const client = { getEventMetadata, searchEvents: vi.fn(async () => [record]) };
    const result = await searchMpOperations({ process: { ...process, platform: preset.platform }, category: preset.category }, { client, profiles: [configured] });
    const query = client.searchEvents.mock.calls[0][0];
    expect(query.where).toContain('subject.process.id = 42'); expect(query.where).not.toContain('object.process.id =');
    if (preset.selectorRequired) expect(query.where).toContain('datafield1 in');
    expect(query.select).toContain('action'); expect(query.select).toContain('status');
    expect(query.limit).toBe(25); expect(result.facts).toHaveLength(1);
    expect(result.facts[0].operation).toMatch(/read · success$/);
  }
});

it('queries custom text PIDs as padded hex strings rather than numeric fields', async () => {
  const client = { getEventMetadata, searchEvents: vi.fn(async () => []) };
  await searchMpOperations({ process, category: 'files' }, { client, profiles: [{ ...profile, pid: 'datafield1', pidFormat: 'text' }] });
  expect(client.searchEvents.mock.calls[0][0].where).toContain('0x000000000000002a');
  expect(client.searchEvents.mock.calls[0][0].where).toContain('datafield1 in');
});

it('uses the live schema before POST and avoids the BadRequest caused by unavailable default fields', async () => {
  const available = metadata.fields.filter(field => !['object.fullpath', 'subject.process.guid'].includes(field.name));
  available.push({ name: 'object.path', filterable: true }, { name: 'subject.process.guid', filterable: false });
  const names = new Set(available.map(field => field.name));
  const requests = [];
  const client = new SiemApiClient('https://siem.example', { fetchImpl: async (url, request) => {
    if (String(url).includes('events_metadata')) return new Response(JSON.stringify({ fields: available }), { status: 200, headers: { 'content-type': 'application/json' } });
    const body = JSON.parse(request.body); requests.push(body);
    if (body.filter.select.some(field => !names.has(field)) || body.filter.where.includes('subject.process.guid')) return new Response('BadRequest', { status: 400 });
    return new Response(JSON.stringify({ events: [{ ...event(1), 'object.fullpath': undefined, 'object.path': '/example', 'object.name': 'file' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const result = await searchMpOperations({ process: { ...process, guid: 'abc' }, category: 'files' }, { client, profiles: [profile] });
  expect(requests).toHaveLength(1);
  expect(requests[0].filter.select).not.toContain('object.fullpath');
  expect(requests[0].filter.select).not.toContain('subject.process.guid');
  expect(requests[0].filter.where).toContain('subject.process.id = 42');
  expect(result.facts[0].label).toBe('/example · file');
  expect(result.warning).toContain('PID');
});

it('does not post unknown custom fields or hide schema API errors', async () => {
  const client = { getEventMetadata, searchEvents: vi.fn(async () => []) };
  await expect(searchMpOperations({ process, category: 'files' }, { client, profiles: [{ ...profile, target: 'my_missing_field' }] })).rejects.toThrow('my_missing_field');
  expect(client.searchEvents).not.toHaveBeenCalled();
  client.getEventMetadata = async () => { throw new Error('metadata HTTP 403'); };
  await expect(searchMpOperations({ process, category: 'files' }, { client, profiles: [profile] })).rejects.toThrow('metadata HTTP 403');
  expect(client.searchEvents).not.toHaveBeenCalled();
});

it('Security defaults enable without missing classifier errors and untouched old templates migrate', () => {
  for (const id of ['security-files', 'security-registry-access', 'security-access']) {
    const preset = DEFAULT_OPERATION_PROFILES.find(item => item.id === id);
    const settings = normalizeSettings({ operationProfiles: [{ ...preset, enabled: true }] });
    expect(settings.operationProfiles.profiles[0].operationField).toBe('object.type');
  }
  const preset = DEFAULT_OPERATION_PROFILES.find(item => item.id === 'security-files');
  const saved = [{ ...preset, enabled: false, operationField: '', operationValues: 'File', pid: 'customActor' }];
  const migrated = migrateMpOperationProfiles(saved).profiles[0];
  expect(migrated.operationField).toBe('object.type'); expect(migrated.operationValues).toBe('file');
  expect(migrated.pid).toBe('customActor'); expect(migrated.enabled).toBe(false);
  expect(migrateMpOperationProfiles([{ ...saved[0], operationField: 'customType' }]).profiles[0].operationField).toBe('customType');
  expect(migrateMpOperationProfiles([]).profiles).toEqual([]);
});

it('serializes numeric Windows msgid like the existing graph and preserves named/custom IDs', async () => {
  for (const [field, values, expected] of [
    ['msgid', '11, 2', 'msgid in [11, 2]'],
    ['msgid', '4663', 'msgid in [4663]'],
    ['msgid', 'SYSCALL', "msgid in ['SYSCALL']"],
    ['msgid', '11, execve', "(msgid in [11]) or (msgid in ['execve'])"],
    ['datafield1', '11, 2', "datafield1 in ['11', '2']"],
  ]) {
    const requests = [];
    const client = new SiemApiClient('https://siem.example', { fetchImpl: async (url, request) => {
      if (String(url).includes('events_metadata')) return new Response(JSON.stringify(metadata), { headers: { 'content-type': 'application/json' } });
      const body = JSON.parse(request.body); requests.push(body);
      if (/msgid in \['\d/.test(body.filter.where)) return new Response('BadRequest', { status: 400 });
      return new Response(JSON.stringify({ events: [{ ...event(1), [field]: values.split(',')[0].trim() }] }), { headers: { 'content-type': 'application/json' } });
    } });
    const result = await searchMpOperations({ process, category: 'files' }, { client, profiles: [{ ...profile, eventField: field, eventValues: values }] });
    expect(requests[0].filter.where).toContain(expected);
    expect(result.facts).toHaveLength(1);
  }
});

it('400 exposes the rejected query locally without credentials, retry or changing the page', async () => {
  const { SiemApiError } = await import('../src/siem/api/client.js');
  const error = new SiemApiError('http', 'HTTP 400: BadRequest', { status: 400 });
  const client = { getEventMetadata, credentials: 'secret-test-token', searchEvents: vi.fn(async () => { throw error; }) };
  let failure;
  try { await searchMpOperations({ process, category: 'files' }, { client, profiles: [profile] }); } catch (caught) { failure = caught; }
  expect(failure).toBe(error); expect(failure.status).toBe(400);
  expect(failure.message).toContain('Sysmon: files');
  expect(failure.message).toContain('msgid in [11, 2, 15, 23, 26]');
  expect(failure.message).toContain('"limit": 25'); expect(failure.message).toContain('"offset": 0');
  expect(failure.message).toContain('"orderBy"'); expect(failure.message).not.toContain('secret-test-token');
  expect(client.searchEvents).toHaveBeenCalledTimes(1);
});

it('Security registry defaults match the reported 4663 field structure without trusting the provider title', async () => {
  // Synthetic minimal fixture: no uploaded body, host, asset IDs or registry path.
  const record = {
    uuid: 'synthetic-registry-access', time: new Date(from + 1000).toISOString(),
    'event_src.host': process.host, 'event_src.title': 'windows',
    'event_src.provider': 'Microsoft-Windows-Security-Auditing', 'event_src.subsys': 'security',
    msgid: '4663', object: 'reg_object', 'object.type': 'key',
    'object.fullpath': '\\registry\\machine\\software\\example',
    'subject.process.id': '42', 'subject.process.guid': null,
    'object.process.id': null, action: 'access', status: 'success',
  };
  const preset = { ...DEFAULT_OPERATION_PROFILES.find(item => item.id === 'security-registry-access'), enabled: true };
  const client = { getEventMetadata, searchEvents: vi.fn(async () => [record]) };
  const page = await searchMpOperations({ process, category: 'registry' }, { client, profiles: [preset] });
  const query = client.searchEvents.mock.calls[0][0];
  expect(query.where).toContain("event_src.provider in ['Microsoft-Windows-Security-Auditing']");
  expect(query.where).toContain("object.type in ['key']");
  expect(query.where).not.toContain('event_src.title');
  expect(query.where).not.toContain('registry_key');
  expect(query.where).toContain('subject.process.id = 42');
  expect(page.facts).toHaveLength(1);
  expect(page.facts[0].label).toBe(record['object.fullpath']);
  expect(page.facts[0].pid).toBe('42');
});

it('migrates exact old Security source and registry mappings while preserving custom settings', () => {
  const current = DEFAULT_OPERATION_PROFILES.find(item => item.id === 'security-registry-access');
  const old = { ...current, enabled: true, sourceField: 'event_src.title', sourceValues: 'Microsoft-Windows-Security-Auditing', operationField: 'object.type', operationValues: 'registry_key', pid: 'customActor', target: 'customTarget' };
  const migrated = migrateMpOperationProfiles({ version: 1, profiles: [old] });
  expect(migrated.profiles[0]).toMatchObject({ enabled: true, sourceField: 'event_src.provider', operationValues: 'key', pid: 'customActor', target: 'customTarget' });
  expect(migrateMpOperationProfiles(migrated)).toEqual(migrated);
  const custom = migrateMpOperationProfiles([{ ...old, sourceValues: 'windows', operationValues: 'customKey' }]).profiles[0];
  expect(custom.sourceField).toBe('event_src.title'); expect(custom.sourceValues).toBe('windows');
  expect(custom.operationValues).toBe('customKey');
  expect(migrateMpOperationProfiles([{ ...old, operationField: '', operationValues: 'Key' }]).profiles[0]).toMatchObject({ operationField: 'object.type', operationValues: 'key' });
});
