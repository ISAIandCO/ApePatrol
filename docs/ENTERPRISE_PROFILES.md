# Enterprise Profiles

## User import/export

Options → **Enterprise Profiles** exports `apepatrol-settings-profile` schema 1. The bundle contains normalized settings only. API keys remain in `storage.local` and are never included. Import supports:

- `merge`: imported values replace corresponding current values;
- `replace`: imported normalized settings replace the current bundle.

Both modes validate kind/schema and re-run the normal settings validator.

## Firefox managed policy

The manifest declares `managed-schema.json` with one string property, `settingsProfile`. Deploy that property through Firefox enterprise policy as JSON text with this shape:

```json
{
  "schemaVersion": 1,
  "defaults": {
    "instances": ["https://siem.example.internal"],
    "features": {
      "aiAssistant": false,
      "batchIoc": true
    },
    "externalProviders": []
  },
  "lockedPaths": [
    "instances",
    "features.aiAssistant",
    "externalProviders"
  ]
}
```

Managed defaults are applied until the user explicitly changes an unlocked managed path. ApePatrol tracks those non-secret override paths separately so a later policy update does not erase the analyst's value. Every locked path is reapplied from `defaults` by background during load/save while the underlying user value is preserved for policy removal. Invalid/unknown paths are ignored. Secrets are intentionally unsupported in managed profiles.
