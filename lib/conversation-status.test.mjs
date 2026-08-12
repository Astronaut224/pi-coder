import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./conversation-status.ts", import.meta.url), "utf8");

test("display status derives running state first, then manual marks", () => {
  assert.match(source, /export function getConversationDisplayStatus/);
  assert.match(source, /export function isConversationRunning/);
  // Running wins: the running check must appear before the mark checks.
  const fn = source.slice(source.indexOf("export function getConversationDisplayStatus"));
  const runningIdx = fn.indexOf('return "discussing"');
  const completedIdx = fn.indexOf('mark === "completed"');
  const pendingIdx = fn.indexOf('mark === "pending"');
  assert.ok(runningIdx !== -1 && completedIdx !== -1 && pendingIdx !== -1);
  assert.ok(runningIdx < completedIdx && completedIdx < pendingIdx);
});

test("discussing state is derived and never persisted", () => {
  // Only completed/pending can be stored — the mark type union must never
  // include "discussing", and storage filters drop anything else.
  assert.match(source, /export type ConversationMark = "completed" \| "pending"/);
  assert.match(source, /mark === "completed" \|\| mark === "pending"/);
  assert.doesNotMatch(source, /export type ConversationMark = .*discussing/);
  // setConversationMark cannot write discussing.
  const setter = source.slice(source.indexOf("export function setConversationMark"));
  assert.match(setter, /mark === "completed" \|\| mark === "pending"\) next\[sessionId\] = mark;\s*else delete next\[sessionId\]/);
});

test("marks persist to localStorage under a dedicated key, mirroring pinned/unread", () => {
  assert.match(source, /pi-web:session-marks/);
  assert.match(source, /export function loadSessionMarks/);
  assert.match(source, /export function saveSessionMarks/);
  assert.match(source, /export function setConversationMark/);
  // Empty marks remove the storage key instead of writing an empty object.
  assert.match(source, /removeItem\(SESSION_MARKS_STORAGE_KEY\)/);
});

test("time grouping buckets last activity into today/yesterday/last7/last30/earlier", () => {
  assert.match(source, /export type TimeGroupKey = "today" \| "yesterday" \| "last7" \| "last30" \| "earlier"/);
  assert.match(source, /export const TIME_GROUP_ORDER/);
  assert.match(source, /export function getTimeGroupKey/);
  // Buckets are calendar-day based (start-of-today / yesterday / 7 / 30).
  assert.match(source, /startOfToday/);
  assert.match(source, /startOfYesterday/);
  assert.match(source, /startOfLast7/);
  assert.match(source, /startOfLast30/);
});
