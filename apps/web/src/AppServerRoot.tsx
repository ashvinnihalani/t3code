import { RotateCcwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { toSettingsDraft, useAppServerController } from "./appServer/useAppServerController";
import { AppSidebarLayout } from "./components/AppSidebarLayout";
import { RemoteDialog } from "./components/RemoteDialog";
import { SidebarV2 } from "./components/SidebarV2";
import { ThreadWorkspace } from "./components/chat/ThreadWorkspace";
import { SettingsPanels } from "./components/settings/SettingsPanels";
import {
  SETTINGS_SECTIONS,
  SettingsSidebarNav,
  type SettingsSectionId,
} from "./components/settings/SettingsSidebarNav";
import { usePresentationPreferences } from "./settings/presentationPreferences";

type Page = "threads" | "settings";

export function AppServerRoot() {
  const controller = useAppServerController();
  const { preferences, updatePreferences, restoreDefaults, isDefault } =
    usePresentationPreferences();
  const [page, setPage] = useState<Page>("threads");
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("general");
  const [remoteOpen, setRemoteOpen] = useState(false);

  const selectedSummary = useMemo(
    () =>
      controller.connection.snapshot?.threads.find(
        (thread) => thread.id === controller.selectedThreadId,
      ) ?? null,
    [controller.connection.snapshot, controller.selectedThreadId],
  );
  const settingsSectionLabel =
    SETTINGS_SECTIONS.find((section) => section.id === settingsSection)?.label ?? "General";

  useEffect(() => {
    if (page !== "settings") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setPage("threads");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [page]);

  if (controller.settings === null) {
    return (
      <main className="grid h-dvh place-items-center bg-background text-sm text-muted-foreground">
        <p>{controller.settingsError ?? "Loading T3 Codex…"}</p>
      </main>
    );
  }

  const openNewThread = () => {
    setPage("threads");
    void controller.selectThread(null);
  };

  const openRemote = () => {
    setRemoteOpen(true);
    void controller.beginRemotePairing();
  };

  return (
    <AppSidebarLayout
      sidebar={
        page === "settings" ? (
          <SettingsSidebarNav
            activeSection={settingsSection}
            onBack={() => setPage("threads")}
            onSelectSection={setSettingsSection}
          />
        ) : (
          <SidebarV2
            connection={controller.connection}
            groupProjects={preferences.groupProjects}
            projects={controller.projects}
            selectedThreadId={controller.selectedThreadId}
            settingsActive={false}
            timestampFormat={preferences.timestampFormat}
            onNewThread={openNewThread}
            onOpenSettings={() => setPage("settings")}
            onSelectThread={(threadId) => {
              setPage("threads");
              void controller.selectThread(threadId);
            }}
          />
        )
      }
    >
      {page === "settings" ? (
        <>
          <header className="drag-region flex h-[var(--workspace-topbar-height)] shrink-0 items-center px-5">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Settings</span>
              <span className="text-muted-foreground/40">/</span>
              <h1 className="font-medium">{settingsSectionLabel}</h1>
            </div>
            {settingsSection !== "connections" ? (
              <button
                className="no-drag-region ml-auto inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                disabled={isDefault}
                onClick={restoreDefaults}
              >
                <RotateCcwIcon className="size-3.5" /> Restore defaults
              </button>
            ) : null}
          </header>
          <SettingsPanels
            error={controller.settingsError}
            initialDraft={toSettingsDraft(controller.settings)}
            preferences={preferences}
            remoteStatus={controller.connection.remote?.status ?? null}
            section={settingsSection}
            sshHosts={controller.sshHosts}
            onOpenRemote={openRemote}
            onSave={controller.saveSettings}
            onUpdatePreferences={updatePreferences}
          />
        </>
      ) : (
        <ThreadWorkspace
          actionError={controller.actionError}
          connection={controller.connection}
          loading={controller.threadLoading}
          models={controller.models}
          pendingApproval={controller.pendingApproval}
          summary={selectedSummary}
          thread={controller.thread}
          workspace={controller.settings.connection.workspace}
          onInterrupt={controller.interruptTurn}
          onRemote={openRemote}
          onRetry={controller.retry}
          onSend={controller.sendTurn}
          onStart={controller.startThread}
        />
      )}
      {remoteOpen ? (
        <RemoteDialog
          state={controller.remote}
          onCheck={() => void controller.checkRemotePairing()}
          onClose={() => setRemoteOpen(false)}
        />
      ) : null}
    </AppSidebarLayout>
  );
}
