import {
  type EditorId,
  type ProjectId,
  type ProjectRemoteTarget,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { memo, useEffect, useRef, useState } from "react";
import GitActionsControl from "../GitActionsControl";
import type { GitQueryTarget } from "~/lib/gitReactQuery";
import { DiffIcon, SquarePenIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";

interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  draftThreadTitleOverride: string | null;
  activeProjectId: ProjectId | null;
  activeProjectName: string | undefined;
  activeProjectRemote: ProjectRemoteTarget | null;
  isRemoteProject: boolean;
  isGitRepo: boolean;
  openInCwd: string | null;
  openInProjectRoot: boolean;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  diffToggleShortcutLabel: string | null;
  gitTarget: GitQueryTarget;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleDiff: () => void;
  onDraftThreadTitleOverrideChange: ((value: string) => void) | null;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  draftThreadTitleOverride,
  activeProjectId,
  activeProjectName,
  activeProjectRemote,
  isRemoteProject,
  isGitRepo,
  openInCwd,
  openInProjectRoot,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  diffToggleShortcutLabel,
  gitTarget,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleDiff,
  onDraftThreadTitleOverrideChange,
}: ChatHeaderProps) {
  const [isEditingDraftThreadTitle, setIsEditingDraftThreadTitle] = useState(false);
  const draftThreadTitleInputRef = useRef<HTMLInputElement | null>(null);
  const isDraftThreadTitleEditable = onDraftThreadTitleOverrideChange !== null;
  const visibleDraftThreadTitle = draftThreadTitleOverride?.trim() || activeThreadTitle;

  useEffect(() => {
    setIsEditingDraftThreadTitle(false);
  }, [activeThreadId, isDraftThreadTitleEditable]);

  useEffect(() => {
    if (!isEditingDraftThreadTitle) {
      return;
    }
    draftThreadTitleInputRef.current?.focus();
    draftThreadTitleInputRef.current?.select();
  }, [isEditingDraftThreadTitle]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        {isDraftThreadTitleEditable && isEditingDraftThreadTitle ? (
          <Input
            ref={draftThreadTitleInputRef}
            nativeInput
            size="sm"
            value={draftThreadTitleOverride ?? ""}
            onChange={(event) => onDraftThreadTitleOverrideChange(event.currentTarget.value)}
            onBlur={() => setIsEditingDraftThreadTitle(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            placeholder={activeThreadTitle}
            aria-label="New thread title"
            data-testid="draft-thread-title-input"
            className="min-w-0 max-w-md flex-1"
          />
        ) : isDraftThreadTitleEditable ? (
          <button
            type="button"
            className="group -mx-1 flex min-w-0 shrink items-center gap-1 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => setIsEditingDraftThreadTitle(true)}
            title="Click to edit draft thread title"
            data-testid="draft-thread-title-trigger"
          >
            <h2 className="min-w-0 shrink truncate text-sm font-medium text-foreground">
              {visibleDraftThreadTitle}
            </h2>
            <SquarePenIcon
              className="size-3 shrink-0 text-muted-foreground/45 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden="true"
            />
          </button>
        ) : (
          <h2
            className="min-w-0 shrink truncate text-sm font-medium text-foreground"
            title={activeThreadTitle}
          >
            {activeThreadTitle}
          </h2>
        )}
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink truncate">
            {activeProjectName}
          </Badge>
        )}
        {activeProjectName && !isGitRepo && !isRemoteProject && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )}
      </div>
      <div className="@container/header-actions flex min-w-0 flex-1 items-center justify-end gap-2 @sm/header-actions:gap-3">
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {activeProjectName && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            projectId={activeProjectId}
            threadId={activeThreadId}
            openInCwd={openInCwd}
            openInProjectRoot={openInProjectRoot}
            isRemoteProject={isRemoteProject}
          />
        )}
        {activeProjectName && (
          <GitActionsControl
            gitTarget={gitTarget}
            activeThreadId={activeThreadId}
            projectRemote={activeProjectRemote}
          />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});
