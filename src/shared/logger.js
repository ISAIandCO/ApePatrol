const REDACTED_KEYS = /authorization|api.?key|password|token|cookie|secret|event.?payload|request.?body/i;

function redact(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, REDACTED_KEYS.test(key) ? "[redacted]" : redact(item, seen)]));
}

export function createLogger(enabled = false, context = {}) {
  const emit = (level, operation, details) => {
    if (!enabled && ["debug", "info"].includes(level)) return;
    const record = redact({ level, ...context, operation, ...(details && typeof details === "object" ? details : { message: details }) });
    console[level](`[ApePatrol] ${operation}`, record);
  };
  return {
    error: (operation, details) => emit("error", operation, details),
    warn: (operation, details) => emit("warn", operation, details),
    info: (operation, details) => emit("info", operation, details),
    debug: (operation, details) => emit("debug", operation, details),
  };
}
