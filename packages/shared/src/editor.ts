import type { EditorId } from "@t3tools/contracts";

const REMOTE_SSH_SUPPORTED_EDITORS = new Set<EditorId>(["cursor", "vscode", "zed"]);

export function supportsRemoteSshEditor(editorId: EditorId): boolean {
  return REMOTE_SSH_SUPPORTED_EDITORS.has(editorId);
}

export function filterRemoteSshEditors(
  editorIds: ReadonlyArray<EditorId>,
): ReadonlyArray<EditorId> {
  return editorIds.filter(supportsRemoteSshEditor);
}
