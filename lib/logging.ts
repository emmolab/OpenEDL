type LogLevel = "info" | "warn" | "error";
type LogFields = Record<
  string,
  string | number | boolean | null | undefined
>;

function writeLog(level: LogLevel, event: string, fields: LogFields = {}) {
  const payload = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  const message = `[OpenEDL] ${payload}`;
  if (level === "error") {
    console.error(message);
  } else if (level === "warn") {
    console.warn(message);
  } else {
    console.info(message);
  }
}

export function logInfo(event: string, fields?: LogFields) {
  writeLog("info", event, fields);
}

export function logWarn(event: string, fields?: LogFields) {
  writeLog("warn", event, fields);
}

export function logError(event: string, error: unknown, fields?: LogFields) {
  writeLog("error", event, {
    ...fields,
    error: error instanceof Error ? error.message : String(error),
  });
}
