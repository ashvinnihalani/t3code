import type { Thread } from "../types";

export const THREAD_RESTART_TOAST_TITLE = "Thread Could Not be Restarted, Starting New Thread";

const RESUME_FALLBACK_RECONNECT_SUMMARY =
  "Persisted provider session was unavailable; started a new provider session.";

export function buildThreadRestartToastMarker(thread: Pick<Thread, "session">): string | null {
  const session = thread.session;
  if (!session) {
    return null;
  }
  if (session.reconnectState !== "fresh-start") {
    return null;
  }
  if (session.reconnectSummary !== RESUME_FALLBACK_RECONNECT_SUMMARY) {
    return null;
  }
  const updatedAt = session.reconnectUpdatedAt ?? session.updatedAt;
  return `${session.reconnectState}:${updatedAt}:${session.reconnectSummary}`;
}
