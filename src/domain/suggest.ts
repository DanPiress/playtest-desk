// Getting a suggestion for a tester note, and checking it before it reaches the form.
import { Issue, KeptDetail, NOTE_MAX, StatusReply, Suggestion, SuggestReply } from "./schema";
import { findSampleNote } from "./sample";

export type Mode = "checking" | "sample" | "ai";
const DEMO_ONLY = import.meta.env.MODE === "demo";

export class SuggestError extends Error {
  constructor(
    readonly code: "no_match" | "network" | "invalid" | "server" | "timeout" | "too_long",
    message: string,
  ) {
    super(message);
  }
}

/** Asks the local server whether a model connection is configured. Anything but a clear yes means sample mode. */
export async function detectMode(): Promise<Exclude<Mode, "checking">> {
  if (DEMO_ONLY) return "sample";

  try {
    const res = await fetch("/api/status", { headers: { accept: "application/json" } });
    if (!res.ok) return "sample";
    const parsed = StatusReply.safeParse(await res.json());
    return parsed.success && parsed.data.ai ? "ai" : "sample";
  } catch {
    return "sample";
  }
}

const AI_TIMEOUT_MS = 25_000;

export async function requestSuggestion(
  note: string,
  mode: Exclude<Mode, "checking">,
): Promise<{ source: "sample" | "ai"; suggestion: Suggestion }> {
  if (note.length > NOTE_MAX) throw new SuggestError("too_long", `Notes can be up to ${NOTE_MAX} characters.`);

  if (DEMO_ONLY || mode === "sample") {
    const sample = findSampleNote(note);
    if (!sample) {
      throw new SuggestError(
        "no_match",
        "No suggestion is available: this note isn't one of the sample notes, and no AI connection is set up.",
      );
    }
    return { source: "sample", suggestion: structuredClone(sample.suggestion) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let body: unknown;
  try {
    // Only the note text is sent.
    const res = await fetch("/api/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note }),
      signal: controller.signal,
    });
    body = await res.json().catch(() => null);
    if (!res.ok && body === null) throw new SuggestError("server", `The suggestion service answered ${res.status}.`);
  } catch (err) {
    if (err instanceof SuggestError) throw err;
    if (controller.signal.aborted) throw new SuggestError("timeout", "The suggestion took too long and was stopped.");
    throw new SuggestError("network", "The suggestion service couldn't be reached.");
  } finally {
    clearTimeout(timer);
  }

  const reply = SuggestReply.safeParse(body);
  if (!reply.success) {
    throw new SuggestError("invalid", "The suggestion came back in an unexpected format, so it wasn't used.");
  }
  if (!reply.data.ok) throw new SuggestError("server", reply.data.message);
  return { source: "ai", suggestion: reply.data.suggestion };
}

export interface CheckedDetail extends KeptDetail {
  found: boolean;
}

/** A kept detail counts only if its quoted words really appear in the note. */
export function checkDetails(note: string, details: KeptDetail[]): CheckedDetail[] {
  const hay = note.toLowerCase().replace(/\s+/g, " ");
  return details.map((d) => ({ ...d, found: hay.includes(d.quote.toLowerCase().replace(/\s+/g, " ").trim()) }));
}

const PLACE = /\b(checkpoint|stage|level)\s*(\d+)\b/gi;

function places(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(PLACE)) out.add(`${m[1].toLowerCase()} ${m[2]}`);
  return out;
}

const STOP = new Set(
  (
    "the and but for not with that this was were are has have had you your our they them their his her its from into " +
    "when then than there here what which who how can could would should will just still also very really too some any " +
    "all got get getting keep kept went made make about after before again over only like felt feel seem seems been " +
    "being because while where game player players tester friend issue bug note see saw one two twice little bit"
  ).split(" "),
);

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "").replace(/(.)\1$/, "$1");

/** Key words by stem, keeping the first spelling seen so the reason reads naturally. */
function words(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z']+/g) ?? []) {
    const w = raw.replace(/'.*$/, "");
    if (w.length < 3 || STOP.has(w)) continue;
    const s = stem(w);
    if (s.length >= 3 && !STOP.has(s) && !out.has(s)) out.set(s, w);
  }
  return out;
}

export interface PossibleRepeat {
  issue: Issue;
  reason: string;
}

/**
 * Saved issues that may describe the same problem: they mention the same numbered place
 * (for example "Checkpoint 4") or share several key words. A hint for the reviewer only.
 */
export function findPossibleRepeats(text: string, issues: Issue[], excludeId?: string): PossibleRepeat[] {
  const myPlaces = places(text);
  const myWords = words(text);
  const hits: PossibleRepeat[] = [];
  for (const issue of issues) {
    if (issue.id === excludeId) continue;
    const theirText = `${issue.title} ${issue.description} ${issue.note}`;
    const place = [...myPlaces].find((p) => places(theirText).has(p));
    if (place) {
      hits.push({ issue, reason: `both mention ${place.replace(/^\w/, (c) => c.toUpperCase())}` });
      continue;
    }
    const theirWords = words(theirText);
    const shared = [...myWords.keys()].filter((s) => theirWords.has(s));
    const smaller = Math.min(myWords.size, theirWords.size) || 1;
    if (shared.length >= 3 && shared.length / smaller >= 0.3) {
      const shown = shared.slice(0, 4).map((s) => myWords.get(s));
      hits.push({ issue, reason: `both use the words ${shown.join(", ")}` });
    }
  }
  return hits;
}
