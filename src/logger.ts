const LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[LEVEL] ?? 1;

function log(level: string, msg: string) {
  if ((LEVELS[level] ?? 1) >= currentLevel) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${msg}`;
    if (level === "error") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  }
}

export const logger = {
  debug: (msg: string) => log("debug", msg),
  info: (msg: string) => log("info", msg),
  warn: (msg: string) => log("warn", msg),
  error: (msg: string) => log("error", msg),
};
