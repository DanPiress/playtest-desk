import type { CheckedDetail } from "../domain/suggest";

/** Shows the tester's note with the words each kept detail came from marked. */
export function NoteHighlight({ note, details }: { note: string; details: CheckedDetail[] }) {
  if (!note.trim()) return <p className="note-text note-text--empty">Entered manually. There is no tester note.</p>;

  const lower = note.toLowerCase();
  const ranges: [number, number][] = [];
  for (const d of details) {
    if (!d.found) continue;
    const at = lower.indexOf(d.quote.toLowerCase().trim());
    if (at >= 0) ranges.push([at, at + d.quote.trim().length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }

  const parts: React.ReactNode[] = [];
  let pos = 0;
  merged.forEach(([s, e], i) => {
    if (s > pos) parts.push(note.slice(pos, s));
    parts.push(<mark key={i}>{note.slice(s, e)}</mark>);
    pos = e;
  });
  if (pos < note.length) parts.push(note.slice(pos));

  return <blockquote className="note-text">{parts}</blockquote>;
}
