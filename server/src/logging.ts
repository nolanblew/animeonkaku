export interface AppLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn?(data: Record<string, unknown>, message: string): void;
  error?(data: Record<string, unknown>, message: string): void;
}

export interface RecentLogEntry {
  id: number;
  level: "INFO" | "WARN" | "ERROR";
  time: string;
  message: string;
  data: Record<string, unknown>;
}

export class RecentLogStore {
  private entries: RecentLogEntry[] = [];
  private nextId = 1;
  constructor(private readonly capacity = 500) {}

  add(level: RecentLogEntry["level"], data: Record<string, unknown>, message: string): void {
    this.entries.push({ id: this.nextId++, level, time: new Date().toISOString(), message, data: sanitizeLogData(data) });
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
  }

  list(input: { level: string | undefined; limit: number }): RecentLogEntry[] {
    return this.entries
      .filter((entry) => !input.level || entry.level === input.level)
      .slice(-input.limit)
      .reverse();
  }
}

export function createJsonStdoutLogger(recent?: RecentLogStore): Required<AppLogger> {
  return {
    info: (data, message) => { recent?.add("INFO", data, message); writeJsonLog(30, data, message); },
    warn: (data, message) => { recent?.add("WARN", data, message); writeJsonLog(40, data, message); },
    error: (data, message) => { recent?.add("ERROR", data, message); writeJsonLog(50, data, message); },
  };
}

export function safeExternalUrl(input: string | URL): string {
  try {
    const url = new URL(input);
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return String(input);
  }
}

function writeJsonLog(level: number, data: Record<string, unknown>, message: string): void {
  process.stdout.write(`${JSON.stringify({ level, time: Date.now(), ...data, msg: message })}\n`);
}

function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (/token|password|secret|authorization|cookie/i.test(key)) redacted[key] = "[REDACTED]";
    else if (value instanceof Error) redacted[key] = { name: value.name, message: value.message };
    else redacted[key] = value;
  }
  return redacted;
}
