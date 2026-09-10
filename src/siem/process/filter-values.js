export function processFilterValues(event = {}) {
  const first = names => names.map(name => event[name]).find(value => value !== undefined && value !== null && value !== "");
  return {
    name: first(["object.process.name", "subject.process.name", "object.name"]),
    path: first(["object.process.path", "subject.process.path"]),
    account: first(["subject.account.name", "object.account.name"]),
    pid: first(["object.process.id", "subject.process.id", "object.id"]),
    host: event["event_src.host"],
    eventType: first(["msgid", "event_src.title", "event_src.category"]),
  };
}
