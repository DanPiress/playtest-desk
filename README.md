# Playtest Desk

A small tool for turning playtest notes into reviewed issues. It opens on a sample session for a fictional Roblox game,
**Lava Run 0.4**. You paste a tester's note, get a suggested issue (or write one by hand), check it against the
original note, edit anything, and save it. Saved issues can be searched, filtered by status, edited, exported as CSV
and backed up.

First version, 25 November 2026. The game, testers and notes are fictional.

## Launch

Needs Node.js 22.18 or later.

```powershell
npm install
npm run build
npm run preview
```

Open http://localhost:4190. For development with live reload, run `npm run dev` and open http://localhost:5190.

To run it as a standalone server (for hosting on any Node.js host), build first, then:

```powershell
npm start
```

This serves the app and the suggestion endpoint on http://127.0.0.1:8080. Set `PORT` and `HOST` to change that.
It sends a strict Content-Security-Policy and other security headers.

No key or account is needed. Without one the app runs in **sample mode**: the five sample notes get prewritten
suggestions labelled "Sample suggestion", and any other note goes straight to the manual form.

### Public sample demo

Run `npm run build:demo` to generate `dist-demo/`. This build uses the fictional playtest notes and their
prewritten suggestions. Visitors can also enter their own issues manually, save them in their browser and
export a copy. It works from static hosting without accounts or an API key.

The included `netlify.toml` builds and publishes this sample version from a connected GitHub repository.
For a local preview, serve `dist-demo/` with a static HTTP server. Use the regular build if you need the
optional suggestion endpoint for private testing.

### Optional: real AI suggestions

1. Copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY`. On a host, set it as an environment variable
   instead.
2. Restart the server. The top bar then says "AI suggestions on".

The key is read only by the server (`server/suggest-api.ts`). The browser sends just the note text to
`/api/suggest`. The server asks Claude (`claude-opus-5-5`) for a draft in a fixed format, checks the reply against the
schema, and the browser checks it again before filling the form. Model drafts are labelled "AI suggestion". Each
suggestion is a paid API request on your account.

The endpoint has limits for local or private use:

- It rejects JSON requests with a mismatched browser origin.
- Each address gets 8 suggestions a minute and 200 a day.
- At most 4 suggestions run at once.

Run the public portfolio demo in sample mode with no API key. The origin check is for browser requests, and
the per-address limits reset with the process. For hosted live suggestions, set up access controls and a
shared usage budget to protect the paid account.

If anything fails, the note is kept and the manual form opens.

## Change things yourself

| To change | Open | What to do |
| --- | --- | --- |
| An issue's status | The app | Click the issue in the list, pick Open, In progress or Fixed under Status, then Save changes. |
| The sample notes or their prewritten suggestions | `src/domain/sample.ts` | Edit `SAMPLE_NOTES`. Each `quote` needs the words from the note. The app flags missing quotes. |
| The issues and statuses the sample starts with | `src/domain/sample.ts` | Edit `status:` (`"Open"`, `"In progress"` or `"Fixed"`) in `SAMPLE_ISSUES`. |

After editing `sample.ts`, rebuild (`npm run build`, or let `npm run dev` reload), then press **Reset sample** in the
app. Your browser keeps its saved copy until you reset.

## How suggestions are checked

- **Nothing saves on its own.** A suggestion only fills the form. Every field can be edited before **Save issue**,
  and new issues start Open.
- **Source quotes are checked against the note.** The note is shown beside the draft with matching quotes marked.
  A missing quote is flagged. The reviewer still checks that the title, description and proposed details accurately
  reflect what the tester wrote.
- **Severity is a suggestion.** The form says what was suggested. When a note doesn't say enough, as with "It felt
  laggy", severity is left "Not set".
- **Gaps become questions.** Missing build, device or steps go under "Needs clarification". You can edit, remove or
  add questions, and the list shows how many are open.
- **Repeats are flagged, never merged.** The form warns when a saved issue mentions the same numbered place (for
  example "Checkpoint 4") or shares several key words, and says which. Ticking the box only adds a "Possible repeat of"
  link; both reports stay.
- **Failure keeps your work.** A missing connection, a timeout, a busy or error reply, or a reply in the wrong format
  shows what happened. Your note stays and the manual form opens.

## Your data

- **Saved in this browser.** Issues are saved in this browser and survive a reload.
- If the browser refuses a save, the form keeps the draft or edit open. A failed reset or backup restore leaves the
  existing list in place.
- **Unsaved work is protected.**
  - Leaving a changed draft (Back, Cancel or opening another issue) asks first.
  - A note you've typed comes back after you open and close an issue.
  - A draft in progress is restored if the page reloads.
- **Export and backup** (top of the issue list):
  - **Download CSV** gives a spreadsheet of every issue with its original note. It is UTF-8, every cell is quoted,
    and cells starting with `=`, `+`, `-` or `@` are defused so a spreadsheet won't run them as formulas.
  - **Download backup** and **Restore from backup** move a session to another browser or computer. A restore checks
    the file first and asks before replacing anything.

## Checks

With `npm run preview` running:

```powershell
python scripts\qa_flow.py http://localhost:4190
```

This needs Python with Playwright (`pip install playwright`, then `python -m playwright install chromium`). It runs
47 checks:

- the full flow at 1440 px and at 390 px and 360 px phone widths;
- creating, editing and reloading issues;
- status filters, search, and the empty, loading and error states;
- the five sample notes;
- the suggestion-failure path;
- unsaved-draft protection and restore;
- save, reset and restore behaviour when a browser refuses to write to storage;
- CSV contents, and backup and restore;
- the endpoint's origin check and rate limit;
- the production server's headers, routing and Content-Security-Policy;
- that the browser bundle holds no key.

AI mode is tested with the endpoint mocked in the browser, which tests labelling, the loading state and validation
but not a real model. Screenshots go to `qa/screenshots/`.

## Limits of this version

- **Not tried with a real model.** No key was available. Only the mocked endpoint and the no-key path were tested.
  The first real run should be a few sample notes, checked by hand.
- **One person, one browser.** There is no sign-in or shared storage, so a team can't work on the same list at once;
  backups and CSV move data by hand. Sign-in, a shared database and Roblox integration are planned for a later
  version, as the brief asked.
- **Repeat hints are word-based.** They can miss a repeat worded differently, or flag reports that only share
  vocabulary. They never merge anything.
- **Rate limits reset on restart.** They are kept in the server's memory, which suits one server, not several.
- **Not checked on a real phone.** Phone layouts were checked in Chromium at phone sizes. Safari on iPhone may differ:
  for example, clarification boxes don't grow with their text there and scroll instead.

## Files

```
src/domain/schema.ts    shapes shared by browser and server (zod)
src/domain/sample.ts    the fictional session, sample notes and starting issues
src/domain/store.ts     browser storage (async, so a backend can replace it)
src/domain/suggest.ts   sample/AI suggestion, detail checks, repeat hints
src/domain/export.ts    CSV export and backup files
src/editor.ts           draft state, unsaved-change checks, restore after reload
src/components/         issue list, review form, highlighted note
server/suggest-api.ts   /api/status and /api/suggest (origin check, rate limit, model call)
server/vite-plugin.ts   adds the endpoint to vite dev and vite preview
server/start.ts         production server (npm start)
scripts/qa_flow.py      end-to-end checks
```
