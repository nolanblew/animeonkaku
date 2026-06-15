import type { FastifyInstance } from "fastify";
import type { ServerStatus } from "./statusService.js";

export interface StatusDashboardService {
  getStatus(): Promise<ServerStatus>;
}

export function registerStatusRoutes(app: FastifyInstance, status: StatusDashboardService): void {
  app.get("/v1/status", async () => status.getStatus());

  app.get("/status", async (_request, reply) => {
    const snapshot = await status.getStatus();
    return reply.type("text/html; charset=utf-8").send(renderDashboard(snapshot));
  });
}

function renderDashboard(status: ServerStatus): string {
  const diskUsedPercent = 100 - status.disk.availablePercent;
  const cards = [
    metricCard("Disk Available", formatBytes(status.disk.freeBytes), `${status.disk.availablePercent}% free`),
    metricCard("Media Storage", formatBytes(status.mediaStorage.totalBytes), `${status.mediaStorage.fileCount} files`),
    metricCard("Songs", formatNumber(status.catalog.songs), "catalog themes"),
    metricCard("Images", formatNumber(status.catalog.images), "cached image rows"),
    metricCard("Ready Media", formatNumber(status.catalog.readyMediaFiles), `${status.catalog.mediaFiles} total rows`),
    metricCard("Anime", formatNumber(status.catalog.anime), `${status.catalog.users} users`),
  ].join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Anime Ongaku Server Status</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7f8;
      --panel: #ffffff;
      --text: #182026;
      --muted: #5e6a72;
      --line: #d8e0e5;
      --accent: #1976a2;
      --accent-2: #2d8b57;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
    }
    main {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 40px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-end;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0;
      font-size: 30px;
      line-height: 1.1;
      font-weight: 700;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 17px;
      font-weight: 700;
    }
    .timestamp {
      color: var(--muted);
      font-size: 13px;
      text-align: right;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .card, section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(20, 30, 36, 0.04);
    }
    .card {
      padding: 16px;
      min-height: 104px;
    }
    .label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .value {
      margin-top: 10px;
      font-size: 28px;
      line-height: 1;
      font-weight: 750;
    }
    .hint {
      margin-top: 9px;
      color: var(--muted);
      font-size: 13px;
    }
    section {
      margin-top: 16px;
      padding: 16px;
    }
    .bar {
      height: 12px;
      border-radius: 999px;
      overflow: hidden;
      background: #dfe7eb;
    }
    .bar span {
      display: block;
      height: 100%;
      width: ${Math.max(0, Math.min(100, diskUsedPercent))}%;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th, td {
      padding: 10px 8px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    td.num, th.num { text-align: right; }
    tr:last-child td { border-bottom: 0; }
    code {
      display: block;
      margin-top: 10px;
      color: var(--muted);
      overflow-wrap: anywhere;
      font-size: 13px;
    }
    @media (max-width: 760px) {
      header { display: block; }
      .timestamp { text-align: left; margin-top: 8px; }
      .grid { grid-template-columns: 1fr; }
      .value { font-size: 25px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Anime Ongaku Server Status</h1>
        <code>${escapeHtml(status.disk.mediaRoot)}</code>
      </div>
      <div class="timestamp">Updated ${escapeHtml(new Date(status.generatedAt).toLocaleString("en-US"))}</div>
    </header>

    <div class="grid">${cards}</div>

    <section>
      <h2>Disk</h2>
      <div class="bar" aria-label="Disk used"><span></span></div>
      <table>
        <tbody>
          <tr><td>Total</td><td class="num">${formatBytes(status.disk.totalBytes)}</td></tr>
          <tr><td>Used</td><td class="num">${formatBytes(status.disk.usedBytes)}</td></tr>
          <tr><td>Available</td><td class="num">${formatBytes(status.disk.freeBytes)}</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Media Storage</h2>
      ${breakdownTable(status.mediaStorage.byDirectory, "Directory")}
    </section>

    <section>
      <h2>Media Files By Kind</h2>
      <table>
        <thead><tr><th>Kind</th><th class="num">Total</th><th class="num">Ready</th><th class="num">Bytes</th></tr></thead>
        <tbody>
          ${status.mediaByKind
            .map(
              (row) =>
                `<tr><td>${escapeHtml(row.kind)}</td><td class="num">${formatNumber(row.total)}</td><td class="num">${formatNumber(row.ready)}</td><td class="num">${formatBytes(row.bytes)}</td></tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function metricCard(label: string, value: string, hint: string): string {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><div class="hint">${escapeHtml(hint)}</div></div>`;
}

function breakdownTable(rows: { name: string; bytes: number; fileCount: number }[], label: string): string {
  return `<table>
    <thead><tr><th>${escapeHtml(label)}</th><th class="num">Files</th><th class="num">Bytes</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (row) =>
            `<tr><td>${escapeHtml(row.name)}</td><td class="num">${formatNumber(row.fileCount)}</td><td class="num">${formatBytes(row.bytes)}</td></tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const maximumFractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toLocaleString("en-US", { maximumFractionDigits })} ${units[unitIndex]}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
