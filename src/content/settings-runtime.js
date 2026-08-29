export function domSettingsFingerprint(settings) {
  return JSON.stringify({
    eventActions: settings.features.eventActions,
    workspace: settings.features.investigationWorkspace,
    hideEdr: settings.features.disableEdrIntegration,
    iocDescription: settings.features.addIocDescription,
    iocListName: settings.iocListName,
    externalProviders: settings.externalProviders,
    fieldAliases: settings.fieldAliases,
    debugLogging: settings.debugLogging,
  });
}

export function settingsImpact(previous, next, origin) {
  const wasActive = Boolean(previous?.instances?.includes(origin));
  const active = Boolean(next?.instances?.includes(origin));
  return {
    wasActive,
    active,
    rebuildDom: active && (!wasActive || domSettingsFingerprint(previous) !== domSettingsFingerprint(next)),
    clearApiCache: active && JSON.stringify(previous?.searchScope) !== JSON.stringify(next?.searchScope),
  };
}
