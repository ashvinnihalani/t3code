import type { Thread } from "../types";

export const THREAD_RESTART_TOAST_TITLE = "Thread Could Not be Restarted, Starting New Thread";

export function buildThreadRestartToastMarker(thread: Pick<Thread, "session">): string | null {
  const session = thread.session;
  if (!session) {
    return null;
  }
  if (session.reconnectState !== "resume-fallback-fresh-start") {
    return null;
  }
  const updatedAt = session.reconnectUpdatedAt ?? session.updatedAt;
  return `${session.reconnectState}:${updatedAt}`;
}
