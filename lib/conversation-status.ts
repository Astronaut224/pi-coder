/**
 * Sidebar conversation display state: manual marks (完成/待定), the derived
 * "讨论中" running state, and the time-bucket grouping for the session list.
 *
 * Design rules:
 * - "讨论中" is NEVER stored. It is derived live from the real running session
 *   set (`/api/agent/running`), so it auto-appears while a task executes and
 *   auto-disappears when the task ends. It also outranks any manual mark in
 *   display, but a manual mark is never overwritten while a task runs — it
 *   simply resurfaces once the session goes idle again.
 * - Manual marks (completed/pending) ARE persisted to localStorage under
 *   `pi-web:session-marks`, mirroring the existing pinned/unread persistence.
 *   Sessions with no mark (and all pre-existing sessions) display nothing.
 * - Time buckets split the non-pinned list by last activity (`modified`):
 *   今天 / 昨天 / 最近7天 / 最近30天 / 更早, ordered newest-first.
 */

export type ConversationMark = "completed" | "pending";
export type ConversationMarkMap = Record<string, ConversationMark>;

/** Display status types; labels/colors are resolved by the UI via i18n. */
export type ConversationStatusType = "discussing" | "completed" | "pending";

export const SESSION_MARKS_STORAGE_KEY = "pi-web:session-marks";

/** True while a real Agent/Task run for this session is active. */
export function isConversationRunning(runningSessionIds: ReadonlySet<string>, sessionId: string): boolean {
  return runningSessionIds.has(sessionId);
}

/**
 * Display priority: running (讨论中) > manual mark (完成/待定) > nothing.
 * Returns null when the session is idle and unmarked — the UI shows no badge.
 */
export function getConversationDisplayStatus(
  sessionId: string,
  mark: ConversationMark | null | undefined,
  runningSessionIds: ReadonlySet<string>,
): ConversationStatusType | null {
  if (isConversationRunning(runningSessionIds, sessionId)) return "discussing";
  if (mark === "completed") return "completed";
  if (mark === "pending") return "pending";
  return null;
}

export function loadSessionMarks(): ConversationMarkMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SESSION_MARKS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ConversationMarkMap = {};
    for (const [id, mark] of Object.entries(parsed)) {
      if (mark === "completed" || mark === "pending") out[id] = mark;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveSessionMarks(marks: ConversationMarkMap): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(marks).filter(
      (entry): entry is [string, ConversationMark] => entry[1] === "completed" || entry[1] === "pending",
    );
    if (entries.length === 0) window.localStorage.removeItem(SESSION_MARKS_STORAGE_KEY);
    else window.localStorage.setItem(SESSION_MARKS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

/**
 * Immutably set or clear one session's manual mark. Only completed/pending can
 * ever be stored — "discussing" is a derived state and cannot be set manually.
 */
export function setConversationMark(
  marks: ConversationMarkMap,
  sessionId: string,
  mark: ConversationMark | null,
): ConversationMarkMap {
  const next = { ...marks };
  if (mark === "completed" || mark === "pending") next[sessionId] = mark;
  else delete next[sessionId];
  return next;
}

export type TimeGroupKey = "today" | "yesterday" | "last7" | "last30" | "earlier";

/** Rendering order of the time buckets, newest first. */
export const TIME_GROUP_ORDER: TimeGroupKey[] = ["today", "yesterday", "last7", "last30", "earlier"];

/**
 * Calendar-day bucket for a session's last activity (`modified`, ISO string).
 * Uses local-time day boundaries so 今天/昨天 match what the user sees.
 */
export function getTimeGroupKey(modified: string, now: Date = new Date()): TimeGroupKey {
  const date = new Date(modified);
  if (Number.isNaN(date.getTime())) return "earlier";

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date >= startOfToday) return "today";

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (date >= startOfYesterday) return "yesterday";

  const startOfLast7 = new Date(startOfToday);
  startOfLast7.setDate(startOfLast7.getDate() - 7);
  if (date >= startOfLast7) return "last7";

  const startOfLast30 = new Date(startOfToday);
  startOfLast30.setDate(startOfLast30.getDate() - 30);
  if (date >= startOfLast30) return "last30";

  return "earlier";
}
