import { describe, it, expect, vi } from 'vitest';
import { searchMpOperations, DEFAULT_OPERATION_PROFILES, processOperationIdentity } from '../src/siem/process/operations.js';
import { normalizeSettings } from '../src/shared/settings.js';
import { SiemApiClient } from '../src/siem/api/client.js';
const from = Date.parse('2026-01-01T00:00:00Z');
const process = { host: 'workstation.example', pid: '42', guid: '', from, to: from + 60000, platform: 'windows' };
const profile = { ...DEFAULT_OPERATION_PROFILES[0], enabled: true };
const event = id => ({ uuid: String(id), time: new Date(from + 1000).toISOString(), 'event_src.host': process.host, 'event_src.title': 'sysmon', msgid: '11', 'subject.process.id': 42, 'object.fullpath': '/example/file' });
describe('MP operation adapter', () => {
  it('pages API by 25 with stable time+uuid ordering and keeps actor separate from target', async () => {
    const requests = [];
    const client = new SiemApiClient('https://siem.example', { fetchImpl: async (url, request) => {
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
    const client = { searchEvents: vi.fn(async () => { throw new Error('HTTP 500'); }) };
    const unsupported = await searchMpOperations({ process: { ...process, platform: 'unix' }, category: 'registry' }, { client, profiles: [profile] });
    expect(unsupported.unsupported).toBeTruthy(); expect(client.searchEvents).not.toHaveBeenCalled();
    await expect(searchMpOperations({ process, category: 'files' }, { client, profiles: [profile] })).rejects.toThrow('HTTP 500');
  });
});
