export interface AppLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn?(data: Record<string, unknown>, message: string): void;
  error?(data: Record<string, unknown>, message: string): void;
}

export function createJsonStdoutLogger(): Required<AppLogger> {
  return {
    info: (data, message) => writeJsonLog(30, data, message),
    warn: (data, message) => writeJsonLog(40, data, message),
    error: (data, message) => writeJsonLog(50, data, message),
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
