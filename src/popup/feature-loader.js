export async function loadOptionalPopupFeatures({ settings, context, request }) {
  const operations = [];
  if (settings.features.relatedEvents) {
    operations.push({ id: "related", run: () => request({ type: "siem:related" }) });
  }
  if (context.event?.correlation_name) {
    operations.push({ id: "rule", run: () => request({ type: "siem:rule-context" }) });
  }

  const settled = await Promise.allSettled(operations.map((operation) => operation.run()));
  return Object.fromEntries(operations.map((operation, index) => {
    const result = settled[index];
    return result.status === "fulfilled"
      ? [operation.id, { ok: true, value: result.value }]
      : [operation.id, { ok: false, error: result.reason }];
  }));
}
