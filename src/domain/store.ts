// Browser storage for this first version. Async on purpose: a shared backend can replace
// this file later without the components changing.
import { StoredState } from "./schema";
import { sampleState } from "./sample";

const KEY = "playtest-desk:v1";

export type LoadResult =
  | { kind: "ok"; state: StoredState; fresh: boolean }
  | { kind: "corrupt"; state: StoredState }
  | { kind: "unavailable"; state: StoredState };

export async function loadState(): Promise<LoadResult> {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return { kind: "unavailable", state: sampleState() };
  }
  if (raw === null) return { kind: "ok", state: sampleState(), fresh: true };
  try {
    const parsed = StoredState.safeParse(JSON.parse(raw));
    if (parsed.success) return { kind: "ok", state: parsed.data, fresh: false };
  } catch {
    /* fall through */
  }
  return { kind: "corrupt", state: sampleState() };
}

/** Throws if the browser refuses to store the data (private mode, storage full, blocked). */
export async function saveState(state: StoredState): Promise<void> {
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

export async function resetState(): Promise<StoredState> {
  const state = sampleState();
  await saveState(state);
  return state;
}
