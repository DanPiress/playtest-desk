// CSV export for spreadsheets and JSON backups for moving data between browsers.
import { StoredState, type Issue } from "./schema";

const HEADER = [
  "ID",
  "Status",
  "Type",
  "Severity",
  "Title",
  "Description",
  "Needs clarification",
  "Possible repeat of",
  "Original note",
  "Source",
  "Created",
  "Updated",
];

/** Quotes every cell and defuses spreadsheet formulas (cells starting with = + - @ or a control character). */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function issuesToCsv(issues: Issue[]): string {
  const rows = [...issues]
    .sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)))
    .map((i) =>
      [
        i.id,
        i.status,
        i.type,
        i.severity ?? "Not set",
        i.title,
        i.description,
        i.needsClarification.join(" | "),
        i.possibleRepeatOf ?? "",
        i.note,
        i.source === "ai" ? "AI suggestion" : i.source === "sample" ? "Sample suggestion" : "Manual entry",
        i.createdAt,
        i.updatedAt,
      ].map(csvCell),
    );
  // BOM so spreadsheet apps read the file as UTF-8.
  return "﻿" + [HEADER.map(csvCell), ...rows].map((r) => r.join(",")).join("\r\n") + "\r\n";
}

export function backupJson(state: StoredState): string {
  return JSON.stringify({ app: "playtest-desk", exportedAt: new Date().toISOString(), ...state }, null, 2);
}

export type ParsedBackup = { ok: true; state: StoredState } | { ok: false; message: string };

export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "That file isn't valid JSON, so nothing was restored." };
  }
  if (typeof raw !== "object" || raw === null || (raw as { app?: unknown }).app !== "playtest-desk") {
    return { ok: false, message: "That file isn't a Playtest Desk backup, so nothing was restored." };
  }
  const parsed = StoredState.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "The backup is damaged or from an incompatible version, so nothing was restored." };
  }
  const ids = new Set(parsed.data.issues.map((i) => i.id));
  if (ids.size !== parsed.data.issues.length) {
    return { ok: false, message: "The backup lists the same issue ID twice, so nothing was restored." };
  }
  const highest = Math.max(0, ...parsed.data.issues.map((i) => Number(i.id.slice(3))));
  return { ok: true, state: { ...parsed.data, nextNumber: Math.max(parsed.data.nextNumber, highest + 1) } };
}

export function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
