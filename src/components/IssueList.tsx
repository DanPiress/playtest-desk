import { useMemo, useRef } from "react";
import { STATUSES, type Issue, type Status, type StoredState } from "../domain/schema";

export type RestorePrompt =
  | null
  | { kind: "confirm"; fileName: string; state: StoredState }
  | { kind: "error"; message: string };

export type Filter = "All" | Status;
const FILTERS: Filter[] = ["All", ...STATUSES];

interface Props {
  issues: Issue[] | null; // null while loading
  filter: Filter;
  onFilter: (f: Filter) => void;
  query: string;
  onQuery: (q: string) => void;
  selectedId: string | null;
  justSavedId: string | null;
  onOpen: (id: string) => void;
  onExportCsv: () => void;
  onBackup: () => void;
  onChooseBackup: (file: File) => void;
  restore: RestorePrompt;
  onConfirmRestore: () => void;
  onCancelRestore: () => void;
}

const statusClass = (s: Status) => `status status--${s.toLowerCase().replace(/\s+/g, "-")}`;

export function matches(issue: Issue, q: string) {
  if (!q.trim()) return true;
  const hay = `${issue.id} ${issue.title} ${issue.description} ${issue.note}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function IssueList(props: Props) {
  const { issues, filter, onFilter, query, onQuery, selectedId, justSavedId, onOpen } = props;
  const searched = useMemo(() => (issues ?? []).filter((i) => matches(i, query)), [issues, query]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { All: searched.length, Open: 0, "In progress": 0, Fixed: 0 };
    for (const i of searched) c[i.status]++;
    return c;
  }, [searched]);
  const shown = useMemo(
    () =>
      searched
        .filter((i) => filter === "All" || i.status === filter)
        .sort((a, b) => Number(b.id.slice(3)) - Number(a.id.slice(3))),
    [searched, filter],
  );

  return (
    <section className="panel issues" id="issues" aria-labelledby="issues-title">
      <header className="panel-head">
        <h2 id="issues-title">
          Issues <span className="count">{issues ? issues.length : ""}</span>
        </h2>
        <DataMenu {...props} />
      </header>
      <RestoreMessage {...props} />

      <div className="issues-tools">
        <label className="field-label" htmlFor="search">
          Search issues
        </label>
        <div className="search">
          <input
            id="search"
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Title, note or ID"
            autoComplete="off"
            disabled={!issues}
          />
        </div>
        <div className="filters" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className="filter"
              aria-pressed={filter === f}
              onClick={() => onFilter(f)}
              disabled={!issues}
            >
              {f} <span className="filter-count">{issues ? counts[f] : "–"}</span>
            </button>
          ))}
        </div>
      </div>

      <div aria-live="polite" className="sr-only">
        {issues ? `${shown.length} ${shown.length === 1 ? "issue" : "issues"} shown` : ""}
      </div>

      {!issues ? (
        <ul className="rows" aria-busy="true" aria-label="Loading issues">
          {[0, 1, 2].map((i) => (
            <li key={i} className="row row--skeleton">
              <span />
              <span />
            </li>
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <EmptyState total={issues.length} filter={filter} query={query} onClear={() => onQuery("")} onAll={() => onFilter("All")} />
      ) : (
        <ul className="rows">
          {shown.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                className={`row${selectedId === issue.id ? " row--selected" : ""}${justSavedId === issue.id ? " row--new" : ""}`}
                onClick={() => onOpen(issue.id)}
                aria-current={selectedId === issue.id ? "true" : undefined}
                data-issue={issue.id}
              >
                <span className="row-top">
                  <span className="row-id">{issue.id}</span>
                  <span className={statusClass(issue.status)}>{issue.status}</span>
                </span>
                <span className="row-title">{issue.title}</span>
                <span className="row-meta">
                  {issue.type === "Suggestion" && <span className="tag tag--suggestion">Suggestion</span>}
                  {issue.severity ? (
                    <span className={`sev sev--${issue.severity.toLowerCase()}`}>{issue.severity}</span>
                  ) : (
                    <span className="sev sev--unset">Severity not set</span>
                  )}
                  {issue.needsClarification.length > 0 && (
                    <span className="tag tag--ask">
                      {issue.needsClarification.length} {issue.needsClarification.length === 1 ? "question" : "questions"}
                    </span>
                  )}
                  {issue.possibleRepeatOf && <span className="tag">Possible repeat of {issue.possibleRepeatOf}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyState(props: { total: number; filter: Filter; query: string; onClear: () => void; onAll: () => void }) {
  const { total, filter, query, onClear, onAll } = props;
  if (total === 0) {
    return (
      <div className="empty">
        <p className="empty-title">No issues yet</p>
        <p>Add a tester note and save the first issue.</p>
      </div>
    );
  }
  if (query.trim()) {
    return (
      <div className="empty">
        <p className="empty-title">
          No {filter === "All" ? "" : `${filter.toLowerCase()} `}issues match “{query.trim()}”
        </p>
        <p>
          <button type="button" className="link" onClick={onClear}>
            Clear the search
          </button>
          {filter !== "All" && (
            <>
              {" "}or{" "}
              <button type="button" className="link" onClick={onAll}>
                show all statuses
              </button>
            </>
          )}
        </p>
      </div>
    );
  }
  const hint: Record<Exclude<Filter, "All">, string> = {
    Open: "Every issue has been picked up. New issues start Open.",
    "In progress": "Nothing is being worked on. Open an issue and set its status to In progress.",
    Fixed: "Nothing is fixed yet. Open an issue and set its status to Fixed.",
  };
  return (
    <div className="empty">
      <p className="empty-title">No {filter === "All" ? "" : filter.toLowerCase()} issues</p>
      <p>{filter === "All" ? "" : hint[filter]}</p>
    </div>
  );
}

function DataMenu({ issues, onExportCsv, onBackup, onChooseBackup }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const close = () => menuRef.current?.removeAttribute("open");
  return (
    <details className="data" ref={menuRef}>
      <summary>Export and backup</summary>
      <div className="data-menu">
        <button type="button" className="btn btn--small" onClick={() => { close(); onExportCsv(); }} disabled={!issues}>
          Download CSV
        </button>
        <button type="button" className="btn btn--small" onClick={() => { close(); onBackup(); }} disabled={!issues}>
          Download backup
        </button>
        <label className="btn btn--small file-btn">
          Restore from backup
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            disabled={!issues}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                close();
                onChooseBackup(file);
              }
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
        </label>
        <p className="hint">The CSV opens in a spreadsheet. A backup file moves this session to another browser.</p>
      </div>
    </details>
  );
}

function RestoreMessage({ issues, restore, onConfirmRestore, onCancelRestore }: Props) {
  if (!restore) return null;
  if (restore.kind === "error") {
    return (
      <div className="restore restore--error" role="alert">
        <p>{restore.message}</p>
        <button type="button" className="btn btn--small" onClick={onCancelRestore}>
          Dismiss
        </button>
      </div>
    );
  }
  const n = restore.state.issues.length;
  return (
    <div className="restore" role="alert">
      <p>
        Replace the {issues?.length ?? 0} issues here with the {n} {n === 1 ? "issue" : "issues"} in {restore.fileName}?
      </p>
      <div className="actions">
        <button type="button" className="btn btn--small btn--danger" onClick={onConfirmRestore}>
          Replace with backup
        </button>
        <button type="button" className="btn btn--small" onClick={onCancelRestore}>
          Cancel
        </button>
      </div>
    </div>
  );
}