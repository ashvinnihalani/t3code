import {
  EDITORS,
  EditorId,
  type ProjectId,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { memo, useCallback, useEffect, useMemo } from "react";
import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from "../../keybindings";
import { usePreferredEditor } from "../../editorPreferences";
import { ChevronDownIcon, FolderClosedIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "../ui/menu";
import { AntigravityIcon, CursorIcon, Icon, VisualStudioCode, Zed } from "../Icons";
import { isMacPlatform, isWindowsPlatform } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { toastManager } from "../ui/toast";

const resolveOptions = (
  platform: string,
  availableEditors: ReadonlyArray<EditorId>,
  isRemoteProject: boolean,
) => {
  const baseOptions: ReadonlyArray<{ label: string; Icon: Icon; value: EditorId }> = [
    {
      label: "Cursor",
      Icon: CursorIcon,
      value: "cursor",
    },
    {
      label: "VS Code",
      Icon: VisualStudioCode,
      value: "vscode",
    },
    {
      label: "Zed",
      Icon: Zed,
      value: "zed",
    },
    {
      label: "Antigravity",
      Icon: AntigravityIcon,
      value: "antigravity",
    },
    {
      label: isMacPlatform(platform)
        ? "Finder"
        : isWindowsPlatform(platform)
          ? "Explorer"
          : "Files",
      Icon: FolderClosedIcon,
      value: "file-manager",
    },
  ];
  return baseOptions.filter(
    (option) =>
      availableEditors.includes(option.value) &&
      (!isRemoteProject || option.value !== "file-manager"),
  );
};

function describeEditor(editorId: EditorId): string {
  return EDITORS.find((editor) => editor.id === editorId)?.label ?? "editor";
}

export const OpenInPicker = memo(function OpenInPicker({
  keybindings,
  availableEditors,
  projectId,
  threadId,
  openInCwd,
  openInProjectRoot,
  isRemoteProject,
}: {
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  projectId: ProjectId | null;
  threadId: ThreadId | null;
  openInCwd: string | null;
  openInProjectRoot: boolean;
  isRemoteProject: boolean;
}) {
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(availableEditors);
  const options = useMemo(
    () => resolveOptions(navigator.platform, availableEditors, isRemoteProject),
    [availableEditors, isRemoteProject],
  );
  const primaryOption = options.find(({ value }) => value === preferredEditor) ?? null;

  const openInEditor = useCallback(
    async (editorId: EditorId | null) => {
      const api = readNativeApi();
      if (!api) return;
      const editor = editorId ?? preferredEditor;
      if (!editor) return;
      try {
        if (openInProjectRoot && projectId) {
          await api.projects.openInEditor({ projectId, editor });
        } else if (projectId && openInCwd) {
          await api.projects.openPathInEditor({
            projectId,
            ...(threadId ? { threadId } : {}),
            relativePath: ".",
            editor,
          });
        } else if (openInCwd) {
          await api.shell.openInEditor(openInCwd, editor);
        } else {
          return;
        }
        setPreferredEditor(editor);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: `Unable to open in ${describeEditor(editor)}`,
          description: error instanceof Error ? error.message : "Unknown error opening editor.",
          ...(threadId ? { data: { threadId } } : {}),
        });
      }
    },
    [openInCwd, openInProjectRoot, preferredEditor, projectId, setPreferredEditor, threadId],
  );

  const openFavoriteEditorShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "editor.openFavorite"),
    [keybindings],
  );

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const api = readNativeApi();
      if (!isOpenFavoriteEditorShortcut(e, keybindings)) return;
      if (!api) return;
      if (!primaryOption) return;
      if (openInProjectRoot && !projectId) return;
      if (!openInProjectRoot && !openInCwd) return;

      e.preventDefault();
      void openInEditor(primaryOption.value);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [keybindings, openInCwd, openInEditor, openInProjectRoot, primaryOption, projectId]);

  const canOpen = primaryOption !== null && ((openInProjectRoot && projectId) || openInCwd);

  return (
    <Group aria-label="Subscription actions">
      <Button
        size="xs"
        variant="outline"
        disabled={!canOpen}
        onClick={() => void openInEditor(preferredEditor)}
      >
        {primaryOption?.Icon && <primaryOption.Icon aria-hidden="true" className="size-3.5" />}
        <span className="sr-only @sm/header-actions:not-sr-only @sm/header-actions:ml-0.5">
          Open
        </span>
      </Button>
      <GroupSeparator className="hidden @sm/header-actions:block" />
      <Menu>
        <MenuTrigger render={<Button aria-label="Copy options" size="icon-xs" variant="outline" />}>
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          {options.length === 0 && <MenuItem disabled>No installed editors found</MenuItem>}
          {options.map(({ label, Icon, value }) => (
            <MenuItem key={value} onClick={() => void openInEditor(value)}>
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {label}
              {value === preferredEditor && openFavoriteEditorShortcutLabel && (
                <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
              )}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </Group>
  );
});
