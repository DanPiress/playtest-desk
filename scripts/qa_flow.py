"""End-to-end checks for Playtest Desk.

Usage:  python scripts/qa_flow.py http://localhost:4190
Needs:  pip install playwright && python -m playwright install chromium
Run against `npm run preview` (the local server must be running). Screenshots go to qa/screenshots/.
"""
import csv
import io
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

from playwright.sync_api import expect, sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4190").rstrip("/")
ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "qa" / "screenshots"
SHOTS.mkdir(parents=True, exist_ok=True)

results: list[tuple[bool, str]] = []
console_errors: list[str] = []


def check(ok: bool, label: str):
    results.append((bool(ok), label))
    print(("PASS " if ok else "FAIL ") + label)


def step(label, fn):
    try:
        fn()
        check(True, label)
    except Exception as e:  # noqa: BLE001
        lines = [l for l in str(e).splitlines() if l.strip()]
        detail = " | ".join(lines[:4])[:400]
        check(False, f"{label} :: {detail}")


NOTE1 = "On Android in build 0.4, I died at Checkpoint 4 and respawned before the lava jump. Happened twice."
NOTE2 = "It felt laggy after I joined."
NOTE3 = "Could checkpoints have a little sound so I know they worked?"
NOTE4 = "Checkpoint 4 sent me back again on my phone, but my friend on PC respawned in the right place."
NOTE5 = "Using keyboard only, Tab moves through the main menu but I can't see which button is selected. Enter still activates a button."
CUSTOM = "The water on level 3 is too dark on my iPad."


def fresh(page):
    page.goto(BASE + "/")
    page.evaluate("localStorage.clear()")
    page.reload()
    expect(page.locator(".row").first).to_be_visible()


def use_note(page, text):
    page.locator("#note").fill(text)


def suggest(page):
    page.get_by_role("button", name="Suggest issue").click()


def choose(page, text):
    page.locator(".draft label.choice", has_text=re.compile(f"^{re.escape(text)}$")).click()


def rows(page):
    return page.locator(".rows .row")


def ids(page):
    return [t.strip() for t in page.locator(".row-id").all_inner_texts()]


def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")


def server_checks():
    with urllib.request.urlopen(BASE + "/api/status") as r:
        check(json.load(r) == {"ai": False}, "Server reports no AI connection (no key configured)")
    req = urllib.request.Request(BASE + "/api/suggest", data=json.dumps({"note": NOTE1}).encode(),
                                 headers={"content-type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req)
        check(False, "Suggest endpoint without a key refuses")
    except urllib.error.HTTPError as e:
        body = json.loads(e.read())
        check(e.code == 503 and body.get("error") == "not_configured", f"Suggest endpoint without a key returns 503 not_configured ({e.code})")
    req = urllib.request.Request(BASE + "/api/suggest", data=json.dumps({"note": "x" * 2100}).encode(),
                                 headers={"content-type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req)
        check(False, "Over-long note rejected")
    except urllib.error.HTTPError as e:
        check(e.code == 413, f"Over-long note rejected with 413 ({e.code})")
    dist = ROOT / "dist" / "assets"
    js = "".join(p.read_text(encoding="utf-8", errors="ignore") for p in dist.glob("*.js"))
    check("ANTHROPIC_API_KEY" not in js and "sk-ant" not in js and "x-api-key" not in js,
          "Browser bundle contains no key name, key or API header")


def http(url, method="GET", body=None, headers=None):
    """Returns (status, headers, body text) without raising on HTTP errors."""
    data = json.dumps(body).encode() if isinstance(body, dict) else body
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")


def production_server(p):
    """Starts `node server/start.ts` on a spare port and checks hosting behaviour, limits and the CSP."""
    port = 8093
    prod = f"http://127.0.0.1:{port}"
    env = {k: v for k, v in os.environ.items() if not k.startswith("ANTHROPIC")}
    env.update(PORT=str(port), HOST="127.0.0.1")
    proc = subprocess.Popen(["node", "server/start.ts"], cwd=ROOT, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(prod + "/api/status", timeout=1)
                break
            except Exception:  # noqa: BLE001
                time.sleep(0.2)
        status, headers, text = http(prod + "/")
        csp = headers.get("Content-Security-Policy") or headers.get("content-security-policy") or ""
        check(status == 200 and "<div id=\"root\">" in text and "default-src 'self'" in csp,
              f"Production server: / serves the app with a Content-Security-Policy ({status})")
        status, _, text = http(prod + "/some/deep/link")
        check(status == 200 and "<div id=\"root\">" in text, "Production server: unknown page paths fall back to the app")
        status, _, _ = http(prod + "/assets/missing.js")
        check(status == 404, f"Production server: missing asset is 404 ({status})")
        status, _, text = http(prod + "/..%2fpackage.json")
        check(status in (400, 404) and "anthropic-ai" not in text, f"Production server: path traversal blocked ({status})")
        status, _, text = http(prod + "/api/status")
        check(status == 200 and json.loads(text) == {"ai": False}, "Production server: /api/status works without a key")

        post = lambda headers: http(prod + "/api/suggest", "POST", {"note": NOTE2}, headers)  # noqa: E731
        status, _, _ = post({"content-type": "application/json", "origin": "https://evil.example"})
        check(status == 403, f"Suggest endpoint refuses requests from another website ({status})")
        status, _, _ = post({"content-type": "text/plain"})
        check(status == 415, f"Suggest endpoint refuses non-JSON bodies ({status})")
        codes = [post({"content-type": "application/json", "origin": prod})[0] for _ in range(9)]
        status, headers, text = post({"content-type": "application/json"})
        retry = headers.get("Retry-After") or headers.get("retry-after")
        check(codes[:8] == [503] * 8 and codes[8] == 429 and status == 429 and retry,
              f"Rate limit: 8 suggestions a minute per address, then 429 with Retry-After ({codes}, {retry})")

        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 860})
        errors = []
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.goto(prod + "/")
        expect(page.locator(".row").first).to_be_visible()
        font = page.evaluate("""async () => { await document.fonts.ready;
            return [...document.fonts].some(f => f.family === 'Figtree Variable' && f.status === 'loaded') }""")
        page.locator("#note").fill(NOTE1)
        suggest(page)
        expect(page.locator(".source .badge")).to_have_text("Sample suggestion")
        check(not errors and font, f"Production server: app runs under the CSP with its font, no console errors {errors[:2]}")
        browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def desktop(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and console_errors.append(f"desktop: {m.text}"))
    page.on("pageerror", lambda e: console_errors.append(f"desktop pageerror: {e}"))

    def first_screen():
        fresh(page)
        expect(page.locator(".sample-flag")).to_have_text("Sample session")
        expect(page.locator(".mode")).to_have_text("Sample suggestions")
        expect(page.locator("#note")).to_be_visible()
        expect(page.get_by_role("button", name="Suggest issue")).to_be_in_viewport()
        assert rows(page).count() == 3, rows(page).count()
        counts = page.locator(".filter").all_inner_texts()
        assert [re.sub(r"\s+", " ", c) for c in counts] == ["All 3", "Open 1", "In progress 1", "Fixed 1"], counts
        page.screenshot(path=str(SHOTS / "desktop-1-main.png"))
    step("Desktop first screen: sample session, note box, Suggest button and 3 issues visible", first_screen)

    def layout():
        r = page.locator("#review").bounding_box()
        i = page.locator("#issues").bounding_box()
        assert i["x"] > r["x"] + r["width"] - 1 and abs(i["y"] - r["y"]) < 5, (r, i)
    step("Desktop: issue list sits beside the review form", layout)

    def create_note1():
        use_note(page, NOTE1)
        suggest(page)
        expect(page.locator(".source .badge")).to_have_text("Sample suggestion")
        assert "Checkpoint 4" in page.locator("#title").input_value()
        expect(page.locator(".evidence .hint").first).to_have_text("All 4 source quotes match the note.")
        assert page.locator(".note-text mark").count() == 4
        facts = page.locator(".facts li").all_inner_texts()
        joined = " ".join(facts)
        for word in ("Android", "0.4", "Checkpoint 4", "Twice"):
            assert word in joined, (word, facts)
        assert page.locator("input[name=severity]").nth(3).is_checked()  # High
        expect(page.locator("#sev-hint")).to_contain_text("Suggested: High")
        page.screenshot(path=str(SHOTS / "desktop-2-sample-suggestion.png"))
        page.locator("#title").fill("Respawn at Checkpoint 4 puts Android players before the lava jump")
        choose(page, "Medium")
        page.get_by_role("button", name="Save issue").click()
        expect(page.locator(".toast")).to_contain_text("Saved LR-4 as Open.")
        row = page.locator('[data-issue="LR-4"]')
        expect(row).to_contain_text("Open")
        expect(row).to_contain_text("Android players")
        expect(row).to_contain_text("Medium")
    step("Create: note 1 suggestion keeps build, device, checkpoint and repeat count; edited and saved as LR-4 (Open)", create_note1)

    def edit_lr4():
        page.locator('[data-issue="LR-4"]').click()
        expect(page.locator("#review-title")).to_have_text("Edit LR-4")
        expect(page.locator(".note-text")).to_contain_text("Happened twice")
        page.locator("#title").fill("Checkpoint 4 respawns Android players before the lava jump")
        page.locator("#description").fill(page.locator("#description").input_value() + " Reproduced by QA.")
        choose(page, "In progress")
        page.screenshot(path=str(SHOTS / "desktop-3-edit.png"))
        page.get_by_role("button", name="Save changes").click()
        expect(page.locator(".toast")).to_contain_text("Saved LR-4: Open to In progress.")
        expect(page.locator('[data-issue="LR-4"]')).to_contain_text("In progress")
    step("Edit: LR-4 title, description and status changed (Open to In progress)", edit_lr4)

    def filters():
        page.locator(".filter", has_text="In progress").click()
        assert sorted(ids(page)) == ["LR-1", "LR-4"], ids(page)
        page.locator(".filter", has_text="Open").click()
        assert "LR-4" not in ids(page) and ids(page) == ["LR-2"], ids(page)
        page.locator(".filter", has_text="Fixed").click()
        assert ids(page) == ["LR-3"], ids(page)
        page.locator(".filter", has_text="All").click()
        assert len(ids(page)) == 4
    step("Filters: after the status change LR-4 moves from Open to In progress results", filters)

    def missing_detail():
        use_note(page, NOTE2)
        suggest(page)
        expect(page.locator(".source .badge")).to_have_text("Sample suggestion")
        assert page.locator("input[name=severity]").first.is_checked()  # Not set
        expect(page.locator("#sev-hint")).to_contain_text("No severity suggested")
        qs = [page.locator(f"#q-{i}").input_value() for i in range(page.locator(".clarify li").count())]
        text = " ".join(qs).lower()
        assert "device" in text and "build" in text and "laggy" in text, qs
        page.screenshot(path=str(SHOTS / "desktop-4-missing-detail.png"))
        page.get_by_role("button", name="Save issue").click()
        row = page.locator('[data-issue="LR-5"]')
        expect(row).to_contain_text("Severity not set")
        expect(row).to_contain_text("4 questions")
    step("Missing detail: 'laggy' note flags device, build and meaning, leaves severity unset; saved as LR-5", missing_detail)

    def suggestion_note3():
        use_note(page, NOTE3)
        suggest(page)
        expect(page.locator("input[name=type]").nth(1)).to_be_checked()  # Suggestion
        expect(page.locator(".reviewer-notes")).to_contain_text("not a bug")
        expect(page.locator(".repeat")).to_have_count(0)
        page.get_by_role("button", name="Back to note").click()
        expect(page.locator("#note")).to_have_value(NOTE3)
    step("Note 3 is drafted as a Suggestion (no false repeat flag against LR-4); Back keeps the note", suggestion_note3)

    def repeat_note4():
        use_note(page, NOTE4)
        suggest(page)
        expect(page.locator(".repeat")).to_contain_text("LR-4")
        expect(page.locator(".facts")).to_contain_text("PC respawned correctly")
        expect(page.locator(".repeat input[type=checkbox]")).not_to_be_checked()
        body = page.locator("body").inner_text() + page.locator("#note-hint, .facts").first.inner_text()
        assert "Ã" not in body and "â€" not in body, "mis-encoded characters on the page"
        page.screenshot(path=str(SHOTS / "desktop-5-possible-repeat.png"))
        page.get_by_role("button", name="Save issue").click()
        expect(page.locator('[data-issue="LR-6"]')).to_be_visible()
        expect(page.locator('[data-issue="LR-6"]')).not_to_contain_text("Possible repeat")
        expect(page.locator('[data-issue="LR-4"]')).to_be_visible()
    step("Note 4 flags a possible repeat of LR-4, keeps the PC counterexample, and saves as a separate LR-6", repeat_note4)

    def note5():
        use_note(page, NOTE5)
        suggest(page)
        expect(page.locator("#title")).to_have_value(re.compile("focus", re.I))
        expect(page.locator("#description")).to_have_value(re.compile("Enter still activates", re.I))
        page.get_by_role("button", name="Back to note").click()
    step("Note 5 names the missing focus indicator and keeps that Enter still works", note5)

    def failure_manual():
        use_note(page, CUSTOM)
        suggest(page)
        alert = page.locator(".alert--error")
        expect(alert).to_contain_text("Suggestion failed")
        expect(alert).to_be_focused()
        expect(page.locator(".note-text")).to_have_text(CUSTOM)
        expect(page.locator(".source .badge")).to_have_text("Manual entry")
        page.screenshot(path=str(SHOTS / "desktop-6-suggestion-failed.png"))
        page.get_by_role("button", name="Save issue").click()
        expect(page.locator("#title-error")).to_have_text("Give the issue a title.")
        expect(page.locator("#title")).to_be_focused()
        page.locator("#title").fill("Water on Level 3 is too dark on iPad")
        choose(page, "Low")
        page.get_by_role("button", name="Add question").click()
        expect(page.locator("#q-0")).to_be_focused()
        page.locator("#q-0").fill("Which build?")
        page.get_by_role("button", name="Save issue").click()
        row = page.locator('[data-issue="LR-7"]')
        expect(row).to_contain_text("Water on Level 3")
        expect(row).to_contain_text("1 question")
    step("Suggestion failure (note without a sample): alert shown, note kept, manual form validates and saves LR-7", failure_manual)

    def reload_persists():
        page.reload()
        expect(page.locator('[data-issue="LR-7"]')).to_be_visible()
        assert ids(page) == ["LR-7", "LR-6", "LR-5", "LR-4", "LR-3", "LR-2", "LR-1"], ids(page)
        row = page.locator('[data-issue="LR-4"]')
        expect(row).to_contain_text("Checkpoint 4 respawns Android players")
        expect(row).to_contain_text("In progress")
        page.locator('[data-issue="LR-4"]').click()
        expect(page.locator("#description")).to_have_value(re.compile("Reproduced by QA"))
        expect(page.locator(".note-text")).to_contain_text("Happened twice")
        page.get_by_role("button", name="Cancel").click()
        page.screenshot(path=str(SHOTS / "desktop-7-after-reload.png"))
    step("Reload: all saved and edited issues (with original notes) are still there", reload_persists)

    def search():
        page.locator("#search").fill("laggy")
        assert ids(page) == ["LR-5"], ids(page)
        page.locator("#search").fill("checkpoint 4")
        assert sorted(ids(page)) == ["LR-4", "LR-6"], ids(page)
        page.locator(".filter", has_text="Fixed").click()
        expect(page.locator(".empty")).to_contain_text("No fixed issues match")
        page.get_by_role("button", name="Clear the search").click()
        assert ids(page) == ["LR-3"], ids(page)
        page.locator(".filter", has_text="All").click()
    step("Search finds by note text and works with filters; empty state offers a way out", search)

    def keyboard_focus():
        page.locator("#note").focus()
        page.keyboard.press("Tab")
        focused = page.evaluate("document.activeElement.textContent")
        shadow = page.evaluate("getComputedStyle(document.activeElement).boxShadow")
        assert "Suggest issue" in focused and shadow != "none", (focused, shadow)
    step("Keyboard: Tab from the note reaches Suggest issue with a visible focus ring", keyboard_focus)

    def unsaved_guard():
        use_note(page, NOTE2)
        suggest(page)
        page.locator("#title").fill("Lag after joining, my edit")
        page.locator('[data-issue="LR-2"]').click()
        leave = page.locator(".leave")
        expect(leave).to_contain_text("Discard your changes to this draft and open LR-2?")
        expect(page.get_by_role("button", name="Keep editing")).to_be_focused()
        page.get_by_role("button", name="Keep editing").click()
        expect(page.locator("#title")).to_have_value("Lag after joining, my edit")
        page.get_by_role("button", name="Back to note").click()
        expect(page.locator(".leave")).to_contain_text("The note stays.")
        page.screenshot(path=str(SHOTS / "desktop-8-unsaved-guard.png"))
        page.get_by_role("button", name="Discard changes").click()
        expect(page.locator("#note")).to_have_value(NOTE2)
        page.locator('[data-issue="LR-1"]').click()
        expect(page.locator("#review-title")).to_have_text("Edit LR-1")
        page.get_by_role("button", name="Cancel").click()
        expect(page.locator("#note")).to_have_value(NOTE2)
    step("Unsaved changes: leaving a changed draft asks first; a typed note survives opening and closing an issue", unsaved_guard)

    def draft_after_reload():
        suggest(page)
        page.locator("#title").fill("Half-reviewed lag report")
        page.reload()
        expect(page.locator("#title")).to_have_value("Half-reviewed lag report")
        expect(page.locator(".toast")).to_contain_text("Restored the draft")
        expect(page.locator(".source .badge")).to_have_text("Sample suggestion")
        page.get_by_role("button", name="Back to note").click()
        page.get_by_role("button", name="Discard changes").click()
        page.locator("#note").fill("")
        page.reload()
        expect(page.locator("#note")).to_have_value("")
    step("Reload mid-review restores the unsaved draft in that tab", draft_after_reload)

    def csv_export():
        page.get_by_role("button", name="Enter manually").click()
        page.locator("#title").fill('=HYPERLINK("http://x","click") "quoted"')
        page.get_by_role("button", name="Save issue").click()
        expect(page.locator('[data-issue="LR-8"]')).to_be_visible()
        page.locator(".data summary").click()
        with page.expect_download() as dl:
            page.get_by_role("button", name="Download CSV").click()
        d = dl.value
        assert d.suggested_filename.endswith(".csv"), d.suggested_filename
        raw = pathlib.Path(d.path()).read_bytes()
        assert raw.startswith(b"\xef\xbb\xbf"), "missing UTF-8 BOM"
        table = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
        assert table[0][:5] == ["ID", "Status", "Type", "Severity", "Title"], table[0]
        assert len(table) == 9, len(table)
        lr8 = next(r for r in table if r[0] == "LR-8")
        assert lr8[4] == "'=HYPERLINK(\"http://x\",\"click\") \"quoted\"", lr8[4]
        lr4 = next(r for r in table if r[0] == "LR-4")
        assert lr4[1] == "In progress" and "Happened twice" in lr4[8], lr4
        page.keyboard.press("Escape")
    step("CSV export: all 8 issues with notes, UTF-8, quoted, and formula cells defused", csv_export)

    def backup_restore():
        expect(page.locator(".data[open]")).to_have_count(0)  # menu closed itself after the CSV download
        page.locator(".data summary").click()
        with page.expect_download() as dl:
            page.get_by_role("button", name="Download backup").click()
        backup = pathlib.Path(dl.value.path())
        page.get_by_role("button", name="Reset sample").click()
        page.get_by_role("button", name="Reset", exact=True).click()
        assert len(ids(page)) == 3
        bad = ROOT / "qa" / "logs" / "not-a-backup.json"
        bad.parent.mkdir(parents=True, exist_ok=True)
        bad.write_text('{"hello": 1}', encoding="utf-8")
        page.locator(".data summary").click()
        page.screenshot(path=str(SHOTS / "desktop-9-export-menu.png"))
        page.locator(".file-btn input").set_input_files(str(bad))
        expect(page.locator(".restore--error")).to_contain_text("isn't a Playtest Desk backup")
        page.locator(".restore--error").get_by_role("button", name="Dismiss").click()
        page.locator(".data summary").click()
        page.locator(".file-btn input").set_input_files(str(backup))
        expect(page.locator(".restore")).to_contain_text("Replace the 3 issues here with the 8 issues")
        page.get_by_role("button", name="Replace with backup").click()
        expect(page.locator(".toast")).to_contain_text("Restored 8 issues")
        assert len(ids(page)) == 8, ids(page)
        page.reload()
        assert len(ids(page)) == 8, ids(page)
        expect(page.locator('[data-issue="LR-4"]')).to_contain_text("In progress")
    step("Backup and restore: download, reset, reject a wrong file, restore all 8 issues (survives reload)", backup_restore)

    def blocked_storage():
        original_ids = ids(page)
        original_title = page.locator('[data-issue="LR-4"]').inner_text()
        saved = json.loads(page.evaluate("localStorage.getItem('playtest-desk:v1')"))
        smaller_backup = json.dumps({"app": "playtest-desk", **saved, "issues": saved["issues"][:3]}).encode()
        page.evaluate("""() => {
            window.playtestOriginalSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, value) {
                if (this === localStorage) throw new DOMException('Storage full', 'QuotaExceededError');
                return window.playtestOriginalSetItem.call(this, key, value);
            };
        }""")
        try:
            page.get_by_role("button", name="Enter manually").click()
            page.locator("#title").fill("Keep this unsaved draft")
            page.get_by_role("button", name="Save issue").click()
            expect(page.locator(".toast")).to_contain_text("Save failed")
            expect(page.locator("#title")).to_have_value("Keep this unsaved draft")
            assert ids(page) == original_ids
            page.get_by_role("button", name="Back to note").click()
            page.get_by_role("button", name="Discard changes").click()

            page.locator('[data-issue="LR-4"]').click()
            page.locator("#title").fill("Keep this unsaved edit")
            page.get_by_role("button", name="Save changes").click()
            expect(page.locator(".toast")).to_contain_text("Save failed")
            expect(page.locator("#title")).to_have_value("Keep this unsaved edit")
            assert page.locator('[data-issue="LR-4"]').inner_text() == original_title
            page.get_by_role("button", name="Cancel").click()
            page.get_by_role("button", name="Discard changes").click()

            page.locator(".data summary").click()
            page.locator(".file-btn input").set_input_files({
                "name": "smaller-backup.json",
                "mimeType": "application/json",
                "buffer": smaller_backup,
            })
            page.get_by_role("button", name="Replace with backup").click()
            expect(page.locator(".toast")).to_contain_text("Restore failed")
            assert ids(page) == original_ids

            page.get_by_role("button", name="Reset sample").click()
            page.get_by_role("button", name="Reset", exact=True).click()
            expect(page.locator(".toast")).to_contain_text("Reset failed")
            assert ids(page) == original_ids
        finally:
            page.evaluate("""() => {
                Storage.prototype.setItem = window.playtestOriginalSetItem;
                delete window.playtestOriginalSetItem;
            }""")
        page.reload()
        assert ids(page) == original_ids
    step("Blocked storage keeps unsaved drafts open and preserves existing issues after failed edits, restores and resets", blocked_storage)

    def reset():
        page.get_by_role("button", name="Reset sample").click()
        page.get_by_role("button", name="Reset", exact=True).click()
        expect(page.locator(".toast")).to_contain_text("Sample session reset")
        assert ids(page) == ["LR-3", "LR-2", "LR-1"], ids(page)
        page.reload()
        assert ids(page) == ["LR-3", "LR-2", "LR-1"], ids(page)
    step("Reset sample restores the 3 starting issues, also after reload", reset)

    def corrupt():
        page.evaluate("localStorage.setItem('playtest-desk:v1', '{broken')")
        page.reload()
        expect(page.locator(".banner--warn")).to_contain_text("couldn't be read")
        assert len(ids(page)) == 3
    step("Error state: unreadable saved data shows a warning and loads the sample", corrupt)

    check(overflow(page) <= 0, "Desktop: no horizontal overflow")
    ctx.close()
    browser.close()


VALID_AI = {
    "ok": True,
    "suggestion": {
        "type": "Bug",
        "title": "Water on Level 3 is too dark on iPad",
        "description": "On an iPad, the water on Level 3 looks too dark.",
        "severity": None,
        "keptDetails": [
            {"label": "Device", "value": "iPad", "quote": "my iPad"},
            {"label": "Where", "value": "Level 3", "quote": "level 3"},
            {"label": "Build", "value": "0.5", "quote": "build 0.5"},
        ],
        "needsClarification": ["Which build?"],
        "reviewerNotes": [],
    },
}


def mocked_ai(p):
    """AI mode with the endpoint mocked in the browser. Tests labelling and validation, not a real model."""
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    page = ctx.new_page()
    sent = []
    page.route("**/api/status", lambda r: r.fulfill(json={"ai": True}))
    state = {"mode": "hold"}
    held = []

    def handle(route):
        sent.append(route.request.post_data)
        if state["mode"] == "hold":
            held.append(route)
        elif state["mode"] == "valid":
            route.fulfill(json=VALID_AI)
        elif state["mode"] == "invalid":
            route.fulfill(json={"ok": True, "suggestion": {"title": 42}})
        elif state["mode"] == "error":
            route.fulfill(status=502, json={"ok": False, "error": "rate_limited", "message": "The AI service is busy. Try again in a minute."})
        else:
            route.abort()

    page.route("**/api/suggest", handle)
    fresh(page)

    def ai_label():
        expect(page.locator(".mode")).to_have_text("AI suggestions on")
        use_note(page, CUSTOM)
        suggest(page)
        expect(page.locator(".loading")).to_have_text(re.compile("Reading the note"))
        expect(page.get_by_role("button", name="Suggesting")).to_be_disabled()
        expect(page.locator("#note")).to_have_value(CUSTOM)
        page.screenshot(path=str(SHOTS / "mocked-ai-loading.png"))
        assert held, "request not sent"
        held.pop().fulfill(json=VALID_AI)
        state["mode"] = "valid"
        expect(page.locator(".source .badge")).to_have_text("AI suggestion")
        assert json.loads(sent[-1]) == {"note": CUSTOM}, sent[-1]
        expect(page.locator(".evidence .hint").first).to_have_text("The note is missing 1 of 3 source quotes.")
        expect(page.locator(".fact--missing")).to_contain_text("0.5")
        page.screenshot(path=str(SHOTS / "mocked-ai-suggestion.png"))
        page.get_by_role("button", name="Save issue").click()
        page.locator('[data-issue="LR-4"]').click()
        expect(page.locator(".source .badge")).to_have_text("AI suggestion")
        page.get_by_role("button", name="Cancel").click()
    step("Mocked AI: loading state while waiting, then labelled 'AI suggestion', only {note} sent, missing quote flagged", ai_label)

    for mode, expected in (("invalid", "unexpected format"), ("error", "busy"), ("network", "couldn't be reached")):
        def bad(mode=mode, expected=expected):
            state["mode"] = mode
            use_note(page, CUSTOM)
            suggest(page)
            expect(page.locator(".alert--error")).to_contain_text(expected)
            expect(page.locator(".note-text")).to_have_text(CUSTOM)
            expect(page.locator("#title")).to_be_editable()
            page.locator("#title").fill(f"Manual after {mode}")
            page.get_by_role("button", name="Save issue").click()
            expect(page.locator(".rows")).to_contain_text(f"Manual after {mode}")
        step(f"Mocked AI {mode} reply: rejected, note kept, manual save works", bad)
    ctx.close()
    browser.close()


def phone(p, width=390, height=844, tag="phone"):
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": width, "height": height}, is_mobile=True, has_touch=True, device_scale_factor=2)
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and console_errors.append(f"{tag}: {m.text}"))

    def first():
        fresh(page)
        expect(page.locator(".steps li[aria-current=step]")).to_contain_text("Add a tester note")
        expect(page.get_by_role("button", name="Suggest issue")).to_be_in_viewport()
        expect(page.locator("#note")).to_be_in_viewport()
        r = page.locator("#review").bounding_box()
        i = page.locator("#issues").bounding_box()
        assert i["y"] > r["y"] + r["height"] - 1, "issues should be stacked below review"
        page.screenshot(path=str(SHOTS / f"{tag}-1-main.png"))
    step(f"{tag} {width}px: stacked, step 1 shown, note box and Suggest button on the first screen", first)

    def flow():
        page.get_by_role("button", name="Use sample note 1").click()
        suggest(page)
        expect(page.locator(".steps li[aria-current=step]")).to_contain_text("Review and save")
        save = page.get_by_role("button", name="Save issue")
        expect(save).to_be_in_viewport()
        page.screenshot(path=str(SHOTS / f"{tag}-2-review.png"))
        page.locator("#description").scroll_into_view_if_needed()
        expect(save).to_be_in_viewport()
        save.click()
        expect(page.locator(".toast")).to_contain_text("Saved LR-4")
        expect(page.locator(".steps li[aria-current=step]")).to_be_in_viewport()
        expect(page.locator("#note")).to_be_in_viewport()
        page.screenshot(path=str(SHOTS / f"{tag}-3-saved.png"))
        page.reload()
        expect(page.locator('[data-issue="LR-4"]')).to_be_visible()
        page.locator('[data-issue="LR-4"]').click()
        choose(page, "Fixed")
        page.get_by_role("button", name="Save changes").click()
        page.locator(".filter", has_text="Fixed").click()
        assert sorted(ids(page)) == ["LR-3", "LR-4"], ids(page)
        page.locator("#issues").screenshot(path=str(SHOTS / f"{tag}-4-issues-fixed.png"))
    step(f"{tag}: suggest, save, reload, mark Fixed, Fixed filter shows it; Save button stays on screen", flow)

    check(overflow(page) <= 0, f"{tag}: no horizontal overflow ({overflow(page)})")
    small = page.evaluate("""[...document.querySelectorAll('button, input, textarea, a')].filter(e => {
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 32 && !e.closest('.sr-only');
      }).map(e => (e.getAttribute('aria-label') || e.textContent || e.id).trim().slice(0, 30))""")
    check(len(small) == 0, f"{tag}: interactive targets at least 32px tall {small[:5]}")
    ctx.close()
    browser.close()


if __name__ == "__main__":
    server_checks()
    with sync_playwright() as p:
        production_server(p)
        desktop(p)
        mocked_ai(p)
        phone(p)
        phone(p, 360, 740, "phone-small")
    check(not console_errors, f"No console errors {console_errors[:3]}")
    failed = [l for ok, l in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    sys.exit(1 if failed else 0)
