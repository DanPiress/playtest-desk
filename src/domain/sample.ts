// The fictional sample session. Edit this file to change the sample notes, their prewritten
// suggestions, or the issues (and statuses) the session starts with. After editing, press
// "Reset sample" in the app so your browser reloads the sample from this file.
import type { Issue, Session, StoredState, Suggestion } from "./schema";

export const SAMPLE_SESSION: Session = {
  id: "lava-run-0.4-sample",
  game: "Lava Run",
  build: "0.4",
  playedOn: "2026-11-22",
  testers: "6 testers on Android, iPhone and PC",
  sample: true,
};

export interface SampleNote {
  id: string;
  text: string;
  /** Prewritten example of what a suggestion could look like. Labelled "Sample suggestion" in the app. */
  suggestion: Suggestion;
}

export const SAMPLE_NOTES: SampleNote[] = [
  {
    id: "note-1",
    text: "On Android in build 0.4, I died at Checkpoint 4 and respawned before the lava jump. Happened twice.",
    suggestion: {
      type: "Bug",
      title: "Respawn at Checkpoint 4 puts the player before the lava jump",
      description:
        "After dying at Checkpoint 4, the player respawned before the lava jump instead of at the checkpoint. The tester saw it twice on Android in build 0.4.",
      severity: "High",
      keptDetails: [
        { label: "Device", value: "Android", quote: "On Android" },
        { label: "Build", value: "0.4", quote: "build 0.4" },
        { label: "Where", value: "Checkpoint 4", quote: "Checkpoint 4" },
        { label: "Repeats", value: "Twice", quote: "Happened twice" },
      ],
      needsClarification: ["Did Checkpoint 4 show that it had activated before the player died?"],
      reviewerNotes: [
        "High is only a suggestion: respawning behind the checkpoint costs progress but doesn't stop play.",
      ],
    },
  },
  {
    id: "note-2",
    text: "It felt laggy after I joined.",
    suggestion: {
      type: "Bug",
      title: "Lag reported after joining (details needed)",
      description:
        "The tester says the game felt laggy after joining. The note doesn't say which device or build they used, or what the lag looked like.",
      severity: null,
      keptDetails: [{ label: "When", value: "After joining", quote: "after I joined" }],
      needsClarification: [
        "Which device was the tester using?",
        "Which build were they playing?",
        "What does \"laggy\" mean here: low frame rate, delayed controls, or players jumping around?",
        "Did it settle down, or last the whole session?",
      ],
      reviewerNotes: ["No severity suggested: the note doesn't say how bad it was. Set one once you know more."],
    },
  },
  {
    id: "note-3",
    text: "Could checkpoints have a little sound so I know they worked?",
    suggestion: {
      type: "Suggestion",
      title: "Play a short sound when a checkpoint activates",
      description:
        "Request: play a short sound when a checkpoint activates so players know it registered. The tester is asking for feedback; they don't report a checkpoint failing.",
      severity: "Low",
      keptDetails: [
        { label: "Asks for", value: "Checkpoint sound", quote: "a little sound" },
        { label: "Why", value: "To confirm it worked", quote: "so I know they worked" },
      ],
      needsClarification: [],
      reviewerNotes: ["Kept as a suggestion, not a bug: nothing in the note says a checkpoint broke."],
    },
  },
  {
    id: "note-4",
    text: "Checkpoint 4 sent me back again on my phone, but my friend on PC respawned in the right place.",
    suggestion: {
      type: "Bug",
      title: "Checkpoint 4 sends a phone player back; PC player respawned correctly",
      description:
        "On a phone, Checkpoint 4 sent the tester back again. Their friend on PC respawned in the right place, so the fault may only affect phones.",
      severity: "High",
      keptDetails: [
        { label: "Where", value: "Checkpoint 4", quote: "Checkpoint 4" },
        { label: "Device", value: "Phone", quote: "on my phone" },
        { label: "Repeats", value: "Again", quote: "sent me back again" },
        { label: "Not affected", value: "PC respawned correctly", quote: "my friend on PC respawned in the right place" },
      ],
      needsClarification: ["Which phone and build?", "Where exactly did the player respawn?"],
      reviewerNotes: [
        "This may be the same fault as another Checkpoint 4 respawn report. It stays a separate report until you decide.",
        "The PC counterexample is kept: it suggests the fault is phone-only.",
      ],
    },
  },
  {
    id: "note-5",
    text: "Using keyboard only, Tab moves through the main menu but I can't see which button is selected. Enter still activates a button.",
    suggestion: {
      type: "Bug",
      title: "Main menu has no visible focus indicator",
      description:
        "With the keyboard only, Tab moves through the main menu buttons but nothing shows which one is selected. Enter still activates the selected button, so keyboard control works; only the visible indicator is missing.",
      severity: "Medium",
      keptDetails: [
        { label: "Input", value: "Keyboard only", quote: "Using keyboard only" },
        { label: "Where", value: "Main menu", quote: "main menu" },
        { label: "Missing", value: "Visible selection", quote: "I can't see which button is selected" },
        { label: "Works", value: "Enter activates", quote: "Enter still activates a button" },
      ],
      needsClarification: ["Which build and platform?"],
      reviewerNotes: ["Accessibility issue: keyboard players can't tell where they are in the menu."],
    },
  },
];

const t = (day: number, hour: number) => new Date(Date.UTC(2026, 10, day, hour, 0)).toISOString();

const SAMPLE_ISSUES: Issue[] = [
  {
    id: "LR-1",
    type: "Bug",
    title: "Jump button covers the chat box on small phones",
    description:
      "On a small phone the jump button sits on top of the chat box, so jumping sometimes opens chat instead.",
    severity: "Medium",
    status: "In progress",
    note: "On my small phone the jump button is on top of the chat so I keep opening chat when I jump.",
    source: "manual",
    keptDetails: [{ label: "Device", value: "Small phone", quote: "On my small phone" }],
    needsClarification: ["Which phone model?"],
    possibleRepeatOf: null,
    createdAt: t(22, 14),
    updatedAt: t(23, 10),
  },
  {
    id: "LR-2",
    type: "Bug",
    title: "Coin counter resets to 0 after the Stage 2 teleporter",
    description: "Taking the teleporter to Stage 2 resets the coin counter to zero. Seen on PC in build 0.4.",
    severity: "High",
    status: "Open",
    note: "My coins went back to zero when the teleporter took me to stage 2. Build 0.4 on PC.",
    source: "manual",
    keptDetails: [
      { label: "Where", value: "Stage 2 teleporter", quote: "the teleporter took me to stage 2" },
      { label: "Build", value: "0.4", quote: "Build 0.4" },
      { label: "Device", value: "PC", quote: "on PC" },
    ],
    needsClarification: [],
    possibleRepeatOf: null,
    createdAt: t(22, 15),
    updatedAt: t(22, 15),
  },
  {
    id: "LR-3",
    type: "Bug",
    title: "Lava glow hides platform edges at night",
    description: "In the night lighting the lava glow is bright enough that platform edges are hard to see.",
    severity: "Low",
    status: "Fixed",
    note: "The lava is so bright at night I can't see where the platforms end.",
    source: "manual",
    keptDetails: [{ label: "When", value: "Night lighting", quote: "at night" }],
    needsClarification: [],
    possibleRepeatOf: null,
    createdAt: t(22, 16),
    updatedAt: t(24, 9),
  },
];

export function sampleState(): StoredState {
  return {
    version: 1,
    session: SAMPLE_SESSION,
    issues: structuredClone(SAMPLE_ISSUES),
    nextNumber: SAMPLE_ISSUES.length + 1,
  };
}

const normalise = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function findSampleNote(text: string): SampleNote | undefined {
  const n = normalise(text);
  return SAMPLE_NOTES.find((note) => normalise(note.text) === n);
}
