// Shapes shared by the browser and the local server. Everything that crosses a boundary
// (a model response, a server reply, data read back from browser storage) is parsed with
// these schemas before the app relies on it.
import { z } from "zod";

// No runtime code generation: keeps zod working under the strict Content-Security-Policy (no 'unsafe-eval').
z.config({ jitless: true });

export const SEVERITIES = ["Low", "Medium", "High", "Blocker"] as const;
export const STATUSES = ["Open", "In progress", "Fixed"] as const;
export const ISSUE_TYPES = ["Bug", "Suggestion"] as const;

export type Severity = (typeof SEVERITIES)[number];
export type Status = (typeof STATUSES)[number];
export type IssueType = (typeof ISSUE_TYPES)[number];

export const NOTE_MAX = 2000;

/** A fact the suggestion kept from the note, with the exact words it came from. */
export const KeptDetail = z.object({
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(120),
  quote: z.string().min(1).max(200),
});
export type KeptDetail = z.infer<typeof KeptDetail>;

/** What a suggestion (sample or model) proposes. Nothing here is saved until a person presses Save issue. */
export const Suggestion = z.object({
  type: z.enum(ISSUE_TYPES),
  title: z.string().min(3).max(100),
  description: z.string().min(1).max(600),
  // null means the note doesn't support a severity: a person decides.
  severity: z.enum(SEVERITIES).nullable(),
  keptDetails: z.array(KeptDetail).max(8),
  needsClarification: z.array(z.string().min(1).max(200)).max(6),
  reviewerNotes: z.array(z.string().min(1).max(240)).max(4),
});
export type Suggestion = z.infer<typeof Suggestion>;

export const SuggestionSource = z.enum(["sample", "ai", "manual"]);
export type SuggestionSource = z.infer<typeof SuggestionSource>;

export const Issue = z.object({
  id: z.string().regex(/^LR-\d+$/),
  type: z.enum(ISSUE_TYPES),
  title: z.string().min(1).max(100),
  description: z.string().max(600),
  severity: z.enum(SEVERITIES).nullable(),
  status: z.enum(STATUSES),
  note: z.string().max(NOTE_MAX),
  source: SuggestionSource,
  keptDetails: z.array(KeptDetail),
  needsClarification: z.array(z.string()),
  possibleRepeatOf: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Issue = z.infer<typeof Issue>;

export const Session = z.object({
  id: z.string(),
  game: z.string(),
  build: z.string(),
  playedOn: z.string(),
  testers: z.string(),
  sample: z.boolean(),
});
export type Session = z.infer<typeof Session>;

export const StoredState = z.object({
  version: z.literal(1),
  session: Session,
  issues: z.array(Issue),
  nextNumber: z.number().int().positive(),
});
export type StoredState = z.infer<typeof StoredState>;

/** What the server endpoint returns. */
export const SuggestReply = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), suggestion: Suggestion }),
  z.object({ ok: z.literal(false), error: z.string(), message: z.string() }),
]);
export type SuggestReply = z.infer<typeof SuggestReply>;

export const StatusReply = z.object({ ai: z.boolean() });
