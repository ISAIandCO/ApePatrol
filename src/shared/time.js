export function parseSiemTime(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  if (typeof value === "number") {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  if (typeof value !== "string") return null;
  const native = new Date(value);
  if (!Number.isNaN(native.valueOf()) && /T|Z|[+-]\d\d:?\d\d/.test(value)) return native;
  let match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match) return validLocalDate(+match[3], +match[2] - 1, +match[1], +match[4], +match[5], +(match[6] || 0));
  match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (match) {
    let hour = +match[4] % 12;
    if (match[7].toUpperCase() === "PM") hour += 12;
    const year = +match[3] < 100 ? 2000 + +match[3] : +match[3];
    return validLocalDate(year, +match[1] - 1, +match[2], hour, +match[5], +match[6]);
  }
  return null;
}

function validLocalDate(year, month, day, hour, minute, second) {
  const date = new Date(year, month, day, hour, minute, second);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

export function toEpochSeconds(value) {
  const date = parseSiemTime(value);
  return date ? Math.floor(date.valueOf() / 1000) : null;
}

export function aroundTime(value, seconds) {
  const center = toEpochSeconds(value) ?? Math.floor(Date.now() / 1000);
  return { timeFrom: center - seconds, timeTo: center + seconds };
}
