import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ISSUE_TYPES, NOTE_MAX, SEVERITIES, STATUSES, type Issue } from "../domain/schema";
import { SAMPLE_NOTES } from "../domain/sample";
import { checkDetails, findPossibleRepeats, type Mode } from "../domain/suggest";
import type { Draft, Editor } from "../editor";

export type Pending = { kind: "back" } | { kind: "open"; id: string };
import { NoteHighlight } from "./NoteHighlight";

interface Props {
  editor: Editor;
  mode: Mode;
  issues: Issue[];
  disabled: boolean;
  onNoteChange: (note: string) => void;
  onSuggest: () => void;
  onManual: () => void;
  onDraftChange: (draft: Draft) => void;
  onSave: () => void;
  onBack: () => void;
  pending: Pending | null;
  onConfirmLeave: () => void;
  onCancelLeave: () => void;
}

export function Review(props: Props) {
  const { editor } = props;
  const isEdit = editor.step === "review" && editor.kind === "edit";
  const stepIndex = editor.step === "review" ? 2 : 1;

  return (
    <section className="panel review" aria-labelledby="review-title" id="review">
      <header className="panel-head">
        {isEdit ? (
          <h2 id="review-title">Edit {editor.issueId}</h2>
        ) : (
          <>
            <h2 id="review-title" className="sr-only">
              New issue
            </h2>
            <ol className="steps" aria-label="New issue steps">
              <li aria-current={stepIndex === 1 ? "step" : undefined} className={stepIndex > 1 ? "done" : ""}>
                <span className="step-n" aria-hidden="true">1</span> Add a tester note
              </li>
              <li aria-current={stepIndex === 2 ? "step" : undefined}>
                <span className="step-n" aria-hidden="true">2</span> Review and save
              </li>
            </ol>
          </>
        )}
      </header>

      {props.pending && (
        <LeaveConfirm pending={props.pending} editor={editor} onConfirm={props.onConfirmLeave} onCancel={props.onCancelLeave} />
      )}

      {editor.step === "review" ? <DraftView {...props} editor={editor} /> : <NoteStep {...props} />}
    </section>
  );
}

function NoteStep({ editor, mode, issues, disabled, onNoteChange, onSuggest, onManual }: Props) {
  const loading = editor.step === "loading";
  const note = editor.step === "review" ? "" : editor.note;
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const used = useMemo(() => new Map(issues.map((i) => [i.note.trim(), i.id])), [issues]);

  const suggest = () => {
    if (!note.trim()) {
      setError("Paste or type a tester note first.");
      ref.current?.focus();
      return;
    }
    setError(null);
    onSuggest();
  };

  return (
    <div className="note-step">
      <div className="field">
        <label className="field-label" htmlFor="note">
          Tester note
        </label>
        <p className="hint" id="note-hint">
          Paste what the tester wrote. {mode === "ai" ? "Only this text is sent for an AI suggestion." : ""}
        </p>
        <textarea
          id="note"
          ref={ref}
          rows={5}
          value={note}
          maxLength={NOTE_MAX}
          onChange={(e) => {
            onNoteChange(e.target.value);
            if (error) setError(null);
          }}
          aria-describedby={`note-hint${error ? " note-error" : ""}`}
          aria-invalid={error ? true : undefined}
          readOnly={loading}
          disabled={disabled}
          placeholder="For example: Checkpoint 4 sent me back again on my phone…"
        />
        {error && (
          <p className="error-text" id="note-error">
            {error}
          </p>
        )}
      </div>

      <div className="actions actions--sticky">
        <button type="button" className="btn btn--primary" onClick={suggest} disabled={loading || disabled}>
          {loading ? "Suggesting…" : "Suggest issue"}
        </button>
        <button type="button" className="btn" onClick={onManual} disabled={loading || disabled}>
          Enter manually
        </button>
        {loading && (
          <span className="loading" role="status">
            <span className="spinner" aria-hidden="true" /> Reading the note…
          </span>
        )}
      </div>

      <div className="samples">
        <h3>Sample notes from this session</h3>
        <p className="hint">
          {mode === "ai"
            ? "Fictional notes to try. With AI on, these go to the model too."
            : "Fictional notes with prewritten example suggestions. Any other note can be entered manually."}
        </p>
        <ul>
          {SAMPLE_NOTES.map((s, i) => {
            const savedAs = used.get(s.text.trim());
            return (
              <li key={s.id}>
                <p className="sample-text">{s.text}</p>
                <div className="sample-foot">
                  {savedAs ? <span className="saved-as">Saved as {savedAs}</span> : <span className="muted">Not reviewed</span>}
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => {
                      onNoteChange(s.text);
                      setError(null);
                      ref.current?.focus();
                    }}
                    disabled={loading || disabled}
                    aria-label={`Use sample note ${i + 1}`}
                  >
                    Use note
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

type ReviewEditor = Extract<Editor, { step: "review" }>;

function DraftView({ editor, issues, disabled, onDraftChange, onSave, onBack }: Props & { editor: ReviewEditor }) {
  const { draft, note, source } = editor;
  const isEdit = editor.kind === "edit";
  const set = (patch: Partial<Draft>) => onDraftChange({ ...draft, ...patch });
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  const checked = useMemo(() => checkDetails(note, draft.keptDetails), [note, draft.keptDetails]);
  const unverified = checked.filter((d) => !d.found).length;
  const repeats = useMemo(
    () => findPossibleRepeats(`${note} ${draft.title}`, issues, isEdit ? editor.issueId : undefined),
    [note, draft.title, issues, isEdit, editor],
  );

  useEffect(() => {
    if (editor.kind === "new" && editor.failure) failureRef.current?.focus();
    else titleRef.current?.focus({ preventScroll: true });
    // Only when the draft first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.kind, isEdit ? editor.issueId : note]);

  const save = () => {
    if (!draft.title.trim()) {
      setTitleError("Give the issue a title.");
      titleRef.current?.focus();
      return;
    }
    setTitleError(null);
    onSave();
  };

  return (
    <form
      className="draft"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="draft-grid">
        <aside className="evidence" aria-labelledby={`${uid}-note`}>
          <h3 id={`${uid}-note`}>Original note</h3>
          <NoteHighlight note={note} details={checked} />
          {checked.length > 0 && (
            <>
              <h4>Proposed details</h4>
              <p className="hint">
                {unverified === 0
                  ? `All ${checked.length} source quotes match the note.`
                  : `The note is missing ${unverified} of ${checked.length} source quotes.`}
              </p>
              <ul className="facts">
                {checked.map((d, i) => (
                  <li key={`${d.label}-${i}`} className={d.found ? "" : "fact--missing"}>
                    <span className="fact-label">{d.label}</span>
                    <span className="fact-value">{d.value}</span>
                    {!d.found && <span className="fact-warn">Quote missing from note</span>}
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${d.label}: ${d.value}`}
                      onClick={() => set({ keptDetails: draft.keptDetails.filter((_, j) => j !== i) })}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <div className="fields">
          {editor.kind === "new" && editor.failure && (
            <div className="alert alert--error" role="alert" tabIndex={-1} ref={failureRef}>
              <p className="alert-title">Suggestion failed</p>
              <p>{editor.failure} Your note is kept. Fill in the fields and save the issue manually.</p>
            </div>
          )}

          <SourceBanner source={source} isEdit={isEdit} />

          {draft.reviewerNotes.length > 0 && (
            <ul className="reviewer-notes" aria-label="Notes from the suggestion">
              {draft.reviewerNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}

          <div className="field">
            <label className="field-label" htmlFor="title">
              Title
            </label>
            <input
              id="title"
              ref={titleRef}
              value={draft.title}
              maxLength={100}
              onChange={(e) => {
                set({ title: e.target.value });
                if (titleError && e.target.value.trim()) setTitleError(null);
              }}
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? "title-error" : undefined}
              disabled={disabled}
            />
            {titleError && (
              <p className="error-text" id="title-error">
                {titleError}
              </p>
            )}
          </div>

          <fieldset className="field">
            <legend className="field-label">Type</legend>
            <div className="choices">
              {ISSUE_TYPES.map((t) => (
                <label key={t} className="choice">
                  <input type="radio" name="type" checked={draft.type === t} onChange={() => set({ type: t })} disabled={disabled} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend className="field-label">Severity</legend>
            <p className="hint" id="sev-hint">
              {draft.suggestedSeverity === undefined
                ? "Your call."
                : draft.suggestedSeverity === null
                  ? "No severity suggested: the note doesn't say enough. Your call."
                  : `Suggested: ${draft.suggestedSeverity}. Treat it as a starting point.`}
            </p>
            <div className="choices" aria-describedby="sev-hint">
              <label className="choice">
                <input type="radio" name="severity" checked={draft.severity === null} onChange={() => set({ severity: null })} disabled={disabled} />
                <span>Not set</span>
              </label>
              {SEVERITIES.map((s) => (
                <label key={s} className={`choice choice--${s.toLowerCase()}`}>
                  <input type="radio" name="severity" checked={draft.severity === s} onChange={() => set({ severity: s })} disabled={disabled} />
                  <span>{s}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <label className="field-label" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              rows={4}
              maxLength={600}
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
              disabled={disabled}
            />
          </div>

          <Clarifications items={draft.needsClarification} source={source} onChange={(needsClarification) => set({ needsClarification })} disabled={disabled} />

          {(repeats.length > 0 || draft.possibleRepeatOf) && (
            <div className="repeat">
              <p className="repeat-title">Possible repeat</p>
              {repeats.length > 0 ? (
                <>
                  <ul className="repeat-list">
                    {repeats.map((r) => (
                      <li key={r.issue.id}>
                        <strong>{r.issue.id}</strong> {r.issue.title}: {r.reason}.
                      </li>
                    ))}
                  </ul>
                  <p className="hint">The reports stay separate. Ticking a box only adds a link; you decide what happens next.</p>
                </>
              ) : (
                <p>This issue is marked as a possible repeat. The reports stay separate.</p>
              )}
              {[...new Set([...repeats.map((r) => r.issue.id), ...(draft.possibleRepeatOf ? [draft.possibleRepeatOf] : [])])].map((id) => (
                <label key={id} className="check">
                  <input
                    type="checkbox"
                    checked={draft.possibleRepeatOf === id}
                    onChange={(e) => set({ possibleRepeatOf: e.target.checked ? id : null })}
                    disabled={disabled}
                  />
                  <span>Mark as a possible repeat of {id}</span>
                </label>
              ))}
            </div>
          )}

          {isEdit ? (
            <fieldset className="field">
              <legend className="field-label">Status</legend>
              <div className="choices">
                {STATUSES.map((s) => (
                  <label key={s} className="choice">
                    <input type="radio" name="status" checked={draft.status === s} onChange={() => set({ status: s })} disabled={disabled} />
                    <span>{s}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="hint">The issue starts Open. You can change its status after saving.</p>
          )}

          <div className="actions actions--sticky">
            <button type="submit" className="btn btn--primary" disabled={disabled}>
              {isEdit ? "Save changes" : "Save issue"}
            </button>
            <button type="button" className="btn" onClick={onBack} disabled={disabled}>
              {isEdit ? "Cancel" : "Back to note"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

function LeaveConfirm(props: { pending: Pending; editor: Editor; onConfirm: () => void; onCancel: () => void }) {
  const { pending, editor, onConfirm, onCancel } = props;
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => keepRef.current?.focus(), [pending]);
  const subject = editor.step === "review" && editor.kind === "edit" ? `your changes to ${editor.issueId}` : "your changes to this draft";
  const question =
    pending.kind === "open"
      ? `Discard ${subject} and open ${pending.id}?`
      : `Discard ${subject}?${editor.step === "review" && editor.kind === "new" ? " The note stays." : ""}`;
  return (
    <div className="leave" role="alert">
      <p className="leave-q">{question}</p>
      <div className="actions">
        <button type="button" className="btn btn--small btn--danger" onClick={onConfirm}>
          {pending.kind === "open" ? `Discard and open ${pending.id}` : "Discard changes"}
        </button>
        <button type="button" className="btn btn--small" onClick={onCancel} ref={keepRef}>
          Keep editing
        </button>
      </div>
    </div>
  );
}

function SourceBanner({ source, isEdit }: { source: ReviewEditor["source"]; isEdit: boolean }) {
  if (source === "sample") {
    return (
      <p className="source source--sample">
        <span className="badge">Sample suggestion</span>
        {isEdit ? "Started from a prewritten example." : "A prewritten example, not model output. Check every field."}
      </p>
    );
  }
  if (source === "ai") {
    return (
      <p className="source source--ai">
        <span className="badge">AI suggestion</span>
        {isEdit ? "Started from a model's draft." : "Drafted by a model from the note text. Check every field."}
      </p>
    );
  }
  return (
    <p className="source">
      <span className="badge badge--plain">Manual entry</span>
      {isEdit ? "Written by hand." : "Fill in the fields yourself."}
    </p>
  );
}

function Clarifications(props: { items: string[]; source: ReviewEditor["source"]; onChange: (v: string[]) => void; disabled: boolean }) {
  const { items, source, onChange, disabled } = props;
  const lastRef = useRef<HTMLTextAreaElement>(null);
  const [focusNew, setFocusNew] = useState(false);
  useEffect(() => {
    if (focusNew) {
      lastRef.current?.focus();
      setFocusNew(false);
    }
  }, [focusNew]);

  return (
    <fieldset className="clarify">
      <legend>Needs clarification</legend>
      <p className="hint">
        {items.length > 0
          ? "Questions to ask the tester about missing build, device or steps."
          : source === "manual"
            ? "Add questions for the tester if the build, device or steps are missing."
            : "The suggestion found nothing missing. Add a question if the tester should fill a gap."}
      </p>
      {items.length > 0 && (
        <ul>
          {items.map((q, i) => (
            <li key={i}>
              <label className="sr-only" htmlFor={`q-${i}`}>
                Question {i + 1}
              </label>
              <textarea
                id={`q-${i}`}
                ref={i === items.length - 1 ? lastRef : undefined}
                rows={1}
                value={q}
                maxLength={200}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
                disabled={disabled}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove question ${i + 1}`}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                disabled={disabled}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="btn btn--small"
        onClick={() => {
          onChange([...items, ""]);
          setFocusNew(true);
        }}
        disabled={disabled || items.length >= 6}
      >
        Add question
      </button>
    </fieldset>
  );
}
