import { z } from "zod";
import {
  ISSUE_TYPES,
  KeptDetail,
  NOTE_MAX,
  SEVERITIES,
  STATUSES,
  SuggestionSource,
  type Issue,
  type Suggestion,
} from "./domain/schema";

export const Draft = z.object({
  type: z.enum(ISSUE_TYPES),
  title: z.string().max(100),
  description: z.string().max(600),
  severity: z.enum(SEVERITIES).nullable(),
  /** What the suggestion proposed, kept so the form can say "Suggested: High". */
  suggestedSeverity: z.enum(SEVERITIES).nullable().optional(),
  status: z.enum(STATUSES),
  keptDetails: z.array(KeptDetail),
  needsClarification: z.array(z.string().max(200)),
  reviewerNotes: z.array(z.string()),
  possibleRepeatOf: z.string().nullable(),
});
export type Draft = z.infer<typeof Draft>;

const Note = z.string().max(NOTE_MAX);

// Plain union: two "review" shapes share the same step value.
export const Editor = z.union([
  z.object({ step: z.literal("note"), note: Note }),
  z.object({ step: z.literal("loading"), note: Note }),
  z.object({
    step: z.literal("review"),
    kind: z.literal("new"),
    note: Note,
    source: SuggestionSource,
    draft: Draft,
    /** The draft as it was opened, to tell whether anything was changed. */
    baseline: z.string(),
    failure: z.string().optional(),
  }),
  z.object({
    step: z.literal("review"),
    kind: z.literal("edit"),
    issueId: z.string(),
    note: Note,
    source: SuggestionSource,
    draft: Draft,
    baseline: z.string(),
  }),
]);
export type Editor = z.infer<typeof Editor>;

/** True when leaving now would lose something the reviewer typed or changed. */
export function isDirty(editor: Editor): boolean {
  if (editor.step === "review") return JSON.stringify(editor.draft) !== editor.baseline;
  return editor.note.trim().length > 0;
}

export const baselineOf = (draft: Draft) => JSON.stringify(draft);

export const emptyDraft = (): Draft => ({
  type: "Bug",
  title: "",
  description: "",
  severity: null,
  suggestedSeverity: undefined,
  status: "Open",
  keptDetails: [],
  needsClarification: [],
  reviewerNotes: [],
  possibleRepeatOf: null,
});

export const draftFromSuggestion = (s: Suggestion): Draft => ({
  type: s.type,
  title: s.title,
  description: s.description,
  severity: s.severity,
  suggestedSeverity: s.severity,
  status: "Open",
  keptDetails: s.keptDetails,
  needsClarification: s.needsClarification,
  reviewerNotes: s.reviewerNotes,
  possibleRepeatOf: null,
});

export const draftFromIssue = (i: Issue): Draft => ({
  type: i.type,
  title: i.title,
  description: i.description,
  severity: i.severity,
  suggestedSeverity: undefined,
  status: i.status,
  keptDetails: i.keptDetails,
  needsClarification: i.needsClarification,
  reviewerNotes: [],
  possibleRepeatOf: i.possibleRepeatOf,
});

const DRAFT_KEY = "playtest-desk:draft:v1";

/** Keeps the work in progress for this tab, so a reload doesn't lose a half-reviewed note. */
export function rememberEditor(editor: Editor) {
  try {
    const keep: Editor = editor.step === "loading" ? { step: "note", note: editor.note } : editor;
    if (keep.step === "note" && !keep.note) window.sessionStorage.removeItem(DRAFT_KEY);
    else window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(keep));
  } catch {
    /* Storage blocked: nothing to restore later. */
  }
}

export function recallEditor(issues: Issue[]): Editor | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = Editor.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.step === "loading") return null;
    const e = parsed.data;
    if (e.step === "review" && e.kind === "edit" && !issues.some((i) => i.id === e.issueId)) return null;
    return e;
  } catch {
    return null;
  }
}

export function forgetEditor() {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
