import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("recent list is replaced by time-bucket groups (今天/昨天/最近7天/最近30天/更早)", () => {
  assert.doesNotMatch(source, /sidebar\.recent/);
  assert.match(source, /TIME_GROUP_ORDER/);
  assert.match(source, /getTimeGroupKey\(root\.session\.modified\)/);
  assert.match(source, /t\(`sidebar\.timeGroup\.\$\{key\}`\)/);
  // Pinned sessions stay in the pinned section only — excluded from the buckets.
  assert.match(source, /const pinnedSessions = filteredSessions\.filter\(\(s\) => pinnedSessionIds\.has\(s\.id\)\);/);
  assert.match(source, /const nonPinnedSessions = filteredSessions\.filter\(\(s\) => !pinnedSessionIds\.has\(s\.id\)\);/);
});

test("running status is derived from runningSessionIds, never from the selected session", () => {
  const sessionItem = source.slice(source.indexOf("function SessionItem("));
  assert.match(sessionItem, /getConversationDisplayStatus\(session\.id, mark, runningSessionIds\)/);
  assert.doesNotMatch(sessionItem, /session\.id === selectedSessionId/);
  assert.doesNotMatch(sessionItem, /activeConversationId/);
});

test("manual marks persist to localStorage and are adjustable from a status menu", () => {
  // Marks are loaded on mount and persisted on change (key lives in lib).
  assert.match(source, /loadSessionMarks\(\)/);
  assert.match(source, /saveSessionMarks\(sessionMarks\)/);
  assert.match(source, /setConversationMark\(prev, id, mark\)/);
  assert.match(source, /onSetMark\(session\.id, "completed"\)/);
  assert.match(source, /onSetMark\(session\.id, "pending"\)/);
  assert.match(source, /onSetMark\(session\.id, null\)/);
  // The mark menu is hidden while the session is executing (讨论中).
  assert.match(source, /\{\!isRunning && \(/);
  // Manual marks survive a refresh (discussing does not persist).
  assert.match(source, /saveSessionMarks\(sessionMarks\)/);
  // Old data with no mark must not invent a status.
  assert.match(source, /sessionMarks\[session\.id\] \?\? null/);
});

test("marks for deleted sessions are cleaned up on reload", () => {
  assert.match(source, /Drop manual marks/);
  assert.match(source, /existingIds\.has\(id\)/);
});
