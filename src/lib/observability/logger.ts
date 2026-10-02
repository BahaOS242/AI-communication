/**
 * Minimal structured logger. Emits one JSON line per entry so logs are easy to
 * grep locally and ingest later. Secrets are redacted by key name and by value shape.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY = /(api[-_]?key|authorization|secret|password|token(?!s)|cookie)/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{8,}|tvly-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]+)/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[REDACTED]");
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message) };
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(
  level: Level = (process.env.LOG_LEVEL as Level) || "info",
  bindings: Record<string, unknown> = {},
): Logger {
  const emit = (lvl: Level, msg: string, data?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const line = JSON.stringify(
      redact({ ts: new Date().toISOString(), level: lvl, msg, ...bindings, ...data }),
    );
    if (lvl === "error") console.error(line);
    else if (lvl === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (m, d) => emit("debug", m, d),
    info: (m, d) => emit("info", m, d),
    warn: (m, d) => emit("warn", m, d),
    error: (m, d) => emit("error", m, d),
    child: (b) => createLogger(level, { ...bindings, ...b }),
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
