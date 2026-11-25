import { useCallback, useEffect, useRef, useState } from "react";
import type { Issue, StoredState } from "./domain/schema";
import { loadState, resetState, saveState } from "./domain/store";
import { detectMode, requestSuggestion, SuggestError, type Mode } from "./domain/suggest";
import { backupJson, download, issuesToCsv, parseBackup } from "./domain/export";
import {
  baselineOf,
  draftFromIssue,
  draftFromSuggestion,
  emptyDraft,
  forgetEditor,
  isDirty,
  recallEditor,
  rememberEditor,
  type Draft,
  type Editor,
} from "./editor";
import { IssueList, matches, type Filter, type RestorePrompt } from "./components/IssueList";
import { Review, type Pending } from "./components/Review";

type Banner = { tone: "error" | "warn"; text: string } | null;
type Toast = { text: string; issueId?: string } | null;

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const today = () => new Date().toISOString().slice(0, 10);

export function App() {
  const [state, setState] = useState<StoredState | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [mode, setMode] = useState<Mode>("checking");
  const [editor, setEditor] = useState<Editor>({ step: "note", note: "" });
  /** A note typed before opening an issue, put back when the reviewer returns. */
  const [parkedNote, setParkedNote] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [restore, setRestore] = useState<RestorePrompt>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let live = true;
    loadState().then((r) => {
      if (!live) return;
      setState(r.state);
      if (r.kind === "corrupt") {
        setBanner({
          tone: "warn",
          text: "Saved data in this browser couldn't be read, so the sample session was loaded instead. Earlier changes aren't shown.",
        });
      } else if (r.kind === "unavailable") {
        setBanner({ tone: "error", text: "This browser is blocking storage. Allow site storage to save issues in this browser." });
      }
      const recalled = recallEditor(r.state.issues);
      if (recalled) {
        setEditor(recalled);
        if (recalled.step === "review") setToast({ text: "Restored the draft you were working on before the page reloaded." });
      }
    });
    detectMode().then((m) => live && setMode(m));
    return () => {
      live = false;
    };
  }, []);

  // Keep work in progress for this tab so a reload doesn't lose it.
  useEffect(() => {
    if (state) rememberEditor(editor);
  }, [editor, state]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const persist = useCallback(async (next: StoredState) => {
    try {
      await saveState(next);
      setState(next);
      setBanner((b) => (b?.tone === "error" ? null : b));
      return true;
    } catch {
      setBanner({
        tone: "error",
        text: "The browser couldn't save this change. Check whether site storage is full or blocked, then try again.",
      });
      return false;
    }
  }, []);

  const backToNote = () => {
    setEditor({ step: "note", note: parkedNote });
    setParkedNote("");
  };

  const suggest = async () => {
    if (editor.step !== "note" || mode === "checking") return;
    const note = editor.note;
    const id = ++requestId.current;
    setEditor({ step: "loading", note });
    try {
      const { source, suggestion } = await requestSuggestion(note, mode);
      if (id !== requestId.current) return;
      const draft = draftFromSuggestion(suggestion);
      setEditor({ step: "review", kind: "new", note, source, draft, baseline: baselineOf(draft) });
    } catch (err) {
      if (id !== requestId.current) return;
      const message = err instanceof SuggestError ? err.message : "Something went wrong while getting the suggestion.";
      const draft = emptyDraft();
      setEditor({ step: "review", kind: "new", note, source: "manual", draft, baseline: baselineOf(draft), failure: message });
    }
  };

  const manual = () => {
    if (editor.step !== "note") return;
    const draft = emptyDraft();
    setEditor({ step: "review", kind: "new", note: editor.note, source: "manual", draft, baseline: baselineOf(draft) });
  };

  const doOpen = (id: string) => {
    const issue = state?.issues.find((i) => i.id === id);
    if (!issue) return;
    requestId.current++;
    if (editor.step === "note" || editor.step === "loading") setParkedNote(editor.note);
    const draft = draftFromIssue(issue);
    setEditor({ step: "review", kind: "edit", issueId: id, note: issue.note, source: issue.source, draft, baseline: baselineOf(draft) });
    setPending(null);
    document.getElementById("review")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const openIssue = (id: string) => {
    if (editor.step === "review" && editor.kind === "edit" && editor.issueId === id) return;
    if (editor.step === "review" && isDirty(editor)) {
      setPending({ kind: "open", id });
      document.getElementById("review")?.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    doOpen(id);
  };

  const back = () => {
    if (editor.step !== "review") return;
    if (isDirty(editor)) {
      setPending({ kind: "back" });
      return;
    }
    leave();
  };

  /** Leaves the review step without saving. */
  const leave = () => {
    if (editor.step !== "review") return;
    if (editor.kind === "new") setEditor({ step: "note", note: editor.note });
    else backToNote();
    setPending(null);
  };

  const confirmLeave = () => {
    if (!pending) return;
    if (pending.kind === "open") doOpen(pending.id);
    else leave();
  };

  /** After a save the form is short again: bring its top back into view so the next step is obvious. */
  const revealForm = () =>
    requestAnimationFrame(() => {
      const el = document.getElementById("review");
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
    });

  const setDraft = (draft: Draft) => {
    if (editor.step === "review") setEditor({ ...editor, draft });
  };

  const save = async () => {
    if (!state || editor.step !== "review") return;
    const d = editor.draft;
    const now = new Date().toISOString();
    const clean = {
      type: d.type,
      title: d.title.trim(),
      description: d.description.trim(),
      severity: d.severity,
      keptDetails: d.keptDetails,
      needsClarification: d.needsClarification.map((q) => q.trim()).filter(Boolean),
      possibleRepeatOf: d.possibleRepeatOf,
    };
    setPending(null);

    if (editor.kind === "new") {
      const issue: Issue = {
        id: `LR-${state.nextNumber}`,
        ...clean,
        status: "Open",
        note: editor.note.trim(),
        source: editor.source,
        createdAt: now,
        updatedAt: now,
      };
      const ok = await persist({ ...state, issues: [...state.issues, issue], nextNumber: state.nextNumber + 1 });
      if (!ok) {
        setToast({ text: "Save failed. Your draft is still open." });
        return;
      }
      setJustSaved(issue.id);
      setEditor({ step: "note", note: "" });
      revealForm();
      const visible = (filter === "All" || filter === "Open") && matches(issue, query);
      setToast({
        text: `Saved ${issue.id} as Open.${visible ? "" : " It's hidden by the current filter."}`,
        issueId: issue.id,
      });
    } else {
      const before = state.issues.find((i) => i.id === editor.issueId);
      if (!before) return;
      const updated: Issue = { ...before, ...clean, status: d.status, updatedAt: now };
      const ok = await persist({ ...state, issues: state.issues.map((i) => (i.id === updated.id ? updated : i)) });
      if (!ok) {
        setToast({ text: "Save failed. Your edits are still in the form." });
        return;
      }
      setJustSaved(updated.id);
      backToNote();
      revealForm();
      setToast({
        text: before.status !== updated.status ? `Saved ${updated.id}: ${before.status} to ${updated.status}.` : `Saved changes to ${updated.id}.`,
        issueId: updated.id,
      });
    }
  };

  const reset = async () => {
    try {
      setState(await resetState());
      setBanner(null);
    } catch {
      setBanner({ tone: "error", text: "The browser couldn't save the reset. Your current issues are still here." });
      setToast({ text: "Reset failed. Your current issues are still here." });
      return;
    }
    requestId.current++;
    forgetEditor();
    setEditor({ step: "note", note: "" });
    setParkedNote("");
    setPending(null);
    setFilter("All");
    setQuery("");
    setJustSaved(null);
    setConfirmReset(false);
    setRestore(null);
    setToast({ text: "Sample session reset. Your saved changes were removed." });
  };

  const exportCsv = () => {
    if (!state) return;
    download(`lava-run-${state.session.build}-issues-${today()}.csv`, issuesToCsv(state.issues), "text/csv;charset=utf-8");
    setToast({ text: `Downloaded ${state.issues.length} issues as CSV.` });
  };

  const backup = () => {
    if (!state) return;
    download(`playtest-desk-backup-${today()}.json`, backupJson(state), "application/json");
    setToast({ text: "Downloaded a backup of this session." });
  };

  const chooseBackup = async (file: File) => {
    if (file.size > 2_000_000) {
      setRestore({ kind: "error", message: "That file is too large to be a Playtest Desk backup." });
      return;
    }
    const parsed = parseBackup(await file.text());
    setRestore(parsed.ok ? { kind: "confirm", fileName: file.name, state: parsed.state } : { kind: "error", message: parsed.message });
  };

  const confirmRestore = async () => {
    if (restore?.kind !== "confirm") return;
    const ok = await persist(restore.state);
    if (!ok) {
      setToast({ text: "Restore failed. Your current issues are still here." });
      return;
    }
    requestId.current++;
    forgetEditor();
    setEditor({ step: "note", note: "" });
    setParkedNote("");
    setPending(null);
    setFilter("All");
    setQuery("");
    setJustSaved(null);
    setToast({ text: `Restored ${restore.state.issues.length} issues from ${restore.fileName}.` });
    setRestore(null);
  };

  const showIssue = (id: string) => {
    setFilter("All");
    setQuery("");
    setToast(null);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-issue="${id}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
    });
  };

  const session = state?.session;
  const selectedId = editor.step === "review" && editor.kind === "edit" ? editor.issueId : null;

  return (
    <div className="app">
      <a className="skip" href="#review">
        Skip to the review form
      </a>
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true" className="brand-mark">
            <rect width="32" height="32" rx="7" />
            <path d="M9 9h10a5 5 0 0 1 0 10h-6v4H9z" />
            <circle cx="23" cy="23" r="3" />
          </svg>
          <span>Playtest Desk</span>
        </div>

        <div className="session">
          {session ? (
            <>
              <p className="session-name">
                {session.game} {session.build}
                {session.sample && <span className="sample-flag">Sample session</span>}
              </p>
              <p className="session-meta">
                Playtest on {formatDate(session.playedOn)}, {session.testers}.{" "}
                {session.sample && "The game, testers and notes are fictional."}
              </p>
            </>
          ) : (
            <p className="session-meta" role="status">
              Loading the session…
            </p>
          )}
        </div>

        <div className="top-actions">
          <p className={`mode mode--${mode}`} role="status">
            <span className="mode-dot" aria-hidden="true" />
            {mode === "checking" ? "Checking suggestions…" : mode === "ai" ? "AI suggestions on" : "Sample suggestions"}
          </p>
          {confirmReset ? (
            <div className="confirm" role="group" aria-label="Confirm reset">
              <span>Remove your changes?</span>
              <button type="button" className="btn btn--small btn--danger" onClick={reset}>
                Reset
              </button>
              <button type="button" className="btn btn--small" onClick={() => setConfirmReset(false)}>
                Keep
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn--small" onClick={() => setConfirmReset(true)} disabled={!state}>
              Reset sample
            </button>
          )}
        </div>
        <a className="jump" href="#issues">
          Issues{state ? ` (${state.issues.length})` : ""}
        </a>
      </header>

      {banner && (
        <div className={`banner banner--${banner.tone}`} role="alert">
          <p>{banner.text}</p>
          {banner.tone === "warn" && (
            <button type="button" className="btn btn--small" onClick={() => setBanner(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}

      <main className="layout">
        {state ? (
          <Review
            editor={editor}
            mode={mode}
            issues={state.issues}
            disabled={false}
            onNoteChange={(note) => editor.step === "note" && setEditor({ step: "note", note })}
            onSuggest={suggest}
            onManual={manual}
            onDraftChange={setDraft}
            onSave={save}
            onBack={back}
            pending={pending}
            onConfirmLeave={confirmLeave}
            onCancelLeave={() => setPending(null)}
          />
        ) : (
          <section className="panel review review--loading" aria-busy="true">
            <p role="status">Loading the session…</p>
          </section>
        )}
        <IssueList
          issues={state?.issues ?? null}
          filter={filter}
          onFilter={setFilter}
          query={query}
          onQuery={setQuery}
          selectedId={selectedId}
          justSavedId={justSaved}
          onOpen={openIssue}
          onExportCsv={exportCsv}
          onBackup={backup}
          onChooseBackup={chooseBackup}
          restore={restore}
          onConfirmRestore={confirmRestore}
          onCancelRestore={() => setRestore(null)}
        />
      </main>

      <div className="toast-region" aria-live="polite">
        {toast && (
          <div className="toast">
            <p>{toast.text}</p>
            {toast.issueId && (
              <button type="button" className="link link--light" onClick={() => showIssue(toast.issueId!)}>
                Show {toast.issueId}
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="foot">
        <p>
          Saves stay in this browser. Use Export and backup to move them to another browser or share a CSV. No sign-in,
          shared storage or Roblox connection yet.
        </p>
      </footer>
    </div>
  );
}
