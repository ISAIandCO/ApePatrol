export const IOC_API_PROVIDERS = Object.freeze({
  virustotal: { name: "VirusTotal", origin: "https://www.virustotal.com/*", secret: "virusTotalApiKey", types: ["ip", "hash", "domain", "url"] },
  abuseipdb: { name: "AbuseIPDB", origin: "https://api.abuseipdb.com/*", secret: "abuseIpDbApiKey", types: ["ip"] },
  opentip: { name: "Kaspersky OpenTIP", origin: "https://opentip.kaspersky.com/*", secret: "openTipApiKey", types: ["ip", "hash", "domain", "url"] },
  threatfox: { name: "ThreatFox", origin: "https://threatfox-api.abuse.ch/*", secret: "threatFoxApiKey", types: ["ip", "hash", "domain", "url"] },
});

