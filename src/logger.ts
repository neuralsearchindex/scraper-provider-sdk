/** Minimal console logger (keeps the browser module free of the heavy sdk-node dep). */
type Fields = Record<string, unknown>;
export interface Logger {
  info(obj: Fields | string, msg?: string): void;
  debug(obj: Fields | string, msg?: string): void;
  warn(obj: Fields | string, msg?: string): void;
  error(obj: Fields | string, msg?: string): void;
}
export function createLogger(_opts?: { name?: string }): Logger {
  const emit = (level: "info" | "debug" | "warn" | "error", obj: Fields | string, msg?: string) => {
    const line = typeof obj === "string" ? obj : msg ?? "";
    const meta = typeof obj === "string" ? "" : JSON.stringify(obj);
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](`[${_opts?.name ?? "browser"}] ${line} ${meta}`.trim());
  };
  return {
    info: (o, m) => emit("info", o, m),
    debug: (o, m) => emit("debug", o, m),
    warn: (o, m) => emit("warn", o, m),
    error: (o, m) => emit("error", o, m),
  };
}
