import {
  EDITORS,
  EditorId,
  NativeApi,
  type ProjectOpenPathInEditorInput,
} from "@t3tools/contracts";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";
import { useMemo } from "react";

const LAST_EDITOR_KEY = "t3code:last-editor";

export function usePreferredEditor(availableEditors: ReadonlyArray<EditorId>) {
  const [lastEditor, setLastEditor] = useLocalStorage(LAST_EDITOR_KEY, null, EditorId);

  const effectiveEditor = useMemo(() => {
    if (lastEditor && availableEditors.includes(lastEditor)) return lastEditor;
    return EDITORS.find((editor) => availableEditors.includes(editor.id))?.id ?? null;
  }, [lastEditor, availableEditors]);

  return [effectiveEditor, setLastEditor] as const;
}

export function resolveAndPersistPreferredEditor(
  availableEditors: readonly EditorId[],
): EditorId | null {
  const availableEditorIds = new Set(availableEditors);
  const stored = getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
  if (stored && availableEditorIds.has(stored)) return stored;
  const editor = EDITORS.find((editor) => availableEditorIds.has(editor.id))?.id ?? null;
  if (editor) setLocalStorageItem(LAST_EDITOR_KEY, editor, EditorId);
  return editor ?? null;
}

export type PreferredEditorTarget =
  | { kind: "shell"; target: string }
  | { kind: "project-path"; input: Omit<ProjectOpenPathInEditorInput, "editor"> };

async function resolvePreferredEditor(api: NativeApi): Promise<EditorId> {
  const { availableEditors } = await api.server.getConfig();
  const editor = resolveAndPersistPreferredEditor(availableEditors);
  if (!editor) throw new Error("No available editors found.");
  return editor;
}

export async function openResolvedEditorTargetInPreferredEditor(
  api: NativeApi,
  target: PreferredEditorTarget,
): Promise<EditorId> {
  const editor = await resolvePreferredEditor(api);
  if (target.kind === "project-path") {
    await api.projects.openPathInEditor({
      ...target.input,
      editor,
    });
  } else {
    await api.shell.openInEditor(target.target, editor);
  }
  return editor;
}

export async function openInPreferredEditor(api: NativeApi, targetPath: string): Promise<EditorId> {
  return openResolvedEditorTargetInPreferredEditor(api, {
    kind: "shell",
    target: targetPath,
  });
}
