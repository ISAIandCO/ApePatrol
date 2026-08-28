export function isExtensionPageSender(sender, extensionRoot) {
  const senderUrl = sender?.url ?? sender?.documentUrl;
  if (typeof senderUrl !== "string" || typeof extensionRoot !== "string") return false;
  try {
    const candidate = new URL(senderUrl);
    const root = new URL(extensionRoot);
    return candidate.protocol === root.protocol
      && candidate.hostname === root.hostname
      && candidate.port === root.port
      && candidate.username === root.username
      && candidate.password === root.password;
  } catch {
    return false;
  }
}
