const PROBES = Object.freeze({
  eventMetadata: (client, signal) => client.getEventMetadata({ signal }),
  tableLists: (client, signal) => client.getTableLists({ signal }),
  registeredApps: (client, signal) => client.getRegisteredApplications({ signal }),
  filtersV3: (client, signal) => client.getFilterHierarchy({ signal }),
  currentUser: (client, signal) => client.getCurrentUser({ signal }),
});

export async function detectCapabilities(client, { signal } = {}) {
  const capabilities = {
    eventSearch: false,
    eventMetadata: false,
    filtersV3: false,
    incidents: false,
    tableLists: false,
    assetGrid: false,
    edr: false,
    registeredApps: false,
    currentUser: false,
  };
  await Promise.all(Object.entries(PROBES).map(async ([name, probe]) => {
    try {
      await probe(client, signal);
      capabilities[name] = true;
    } catch (error) {
      if (error.kind === "unauthorized" || error.kind === "forbidden") capabilities[name] = "denied";
    }
  }));
  capabilities.eventSearch = capabilities.eventMetadata === true;
  if (capabilities.registeredApps === true) {
    try {
      const apps = await client.getRegisteredApplications({ signal });
      const serialized = JSON.stringify(apps).toLowerCase();
      capabilities.incidents = serialized.includes("incident");
      capabilities.edr = serialized.includes("edr") || serialized.includes("xdr");
      capabilities.assetGrid = serialized.includes("asset");
    } catch {
      // The successful probe is enough; optional app hints remain false.
    }
  }
  return capabilities;
}
