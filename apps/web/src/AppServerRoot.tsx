import { RotateCcwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAppServerController } from "./appServer/useAppServerController";
import { AppSidebarLayout } from "./components/AppSidebarLayout";
import { AddProjectDialog } from "./components/AddProjectDialog";
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
  const [addProjectOpen, setAddProjectOpen] = useState(false);

  const selectedSummary = useMemo(
    () =>
      controller.selectedEnvironment?.snapshot?.threads.find(
        (thread) => thread.id === controller.selectedThreadId,
      ) ?? null,
    [controller.selectedEnvironment?.snapshot, controller.selectedThreadId],
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

  if (
    controller.settings === null ||
    controller.connection === null ||
    controller.selectedEnvironment === null
  ) {
    return (
      <main className="grid h-dvh place-items-center bg-background text-sm text-muted-foreground">
        <p>{controller.settingsError ?? "Loading T3 Codex…"}</p>
      </main>
    );
  }
  const selectedEnvironment = controller.selectedEnvironment;

  const openNewThread = (environmentId: string | null = controller.selectedEnvironmentId) => {
    setPage("threads");
    const target = environmentId ?? controller.environments[0]?.profile.id;
    if (target === undefined) return;
    const environment = controller.environments.find(
      (candidate) => candidate.profile.id === target,
    );
    if (environment === undefined) return;
    const workspace =
      target === controller.selectedEnvironmentId && controller.selectedWorkspace
        ? controller.selectedWorkspace
        : environment.profile.connection.workspace;
    controller.selectProject(target, workspace);
  };

  const openRemote = (environmentId: string = selectedEnvironment.profile.id) => {
    setRemoteOpen(true);
    void controller.beginRemotePairing(environmentId);
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
            environments={controller.environments}
            groupProjects={preferences.groupProjects}
            projects={controller.projects}
            selectedEnvironmentId={controller.selectedEnvironmentId}
            selectedThreadId={controller.selectedThreadId}
            settingsActive={false}
            timestampFormat={preferences.timestampFormat}
            onNewThread={openNewThread}
            onAddProject={() => setAddProjectOpen(true)}
            onOpenSettings={() => setPage("settings")}
            onSelectProject={(environmentId, workspace) => {
              setPage("threads");
              controller.selectProject(environmentId, workspace);
            }}
            onSelectThread={(environmentId, threadId) => {
              setPage("threads");
              void controller.selectThread(environmentId, threadId);
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
            environments={controller.environments}
            preferences={preferences}
            section={settingsSection}
            sshHosts={controller.sshHosts}
            onOpenRemote={openRemote}
            onRemove={controller.removeEnvironment}
            onSave={controller.saveEnvironment}
            onUpdatePreferences={updatePreferences}
          />
        </>
      ) : (
        <ThreadWorkspace
          actionError={controller.actionError}
          connection={controller.connection}
          environmentName={selectedEnvironment.profile.name}
          loading={controller.threadLoading}
          models={controller.models}
          pendingApproval={controller.pendingApproval}
          summary={selectedSummary}
          thread={controller.thread}
          workspace={
            controller.selectedWorkspace ?? selectedEnvironment.profile.connection.workspace
          }
          onInterrupt={controller.interruptTurn}
          onRemote={() => openRemote(selectedEnvironment.profile.id)}
          onRetry={() => controller.retry(selectedEnvironment.profile.id)}
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
      {addProjectOpen ? (
        <AddProjectDialog
          environments={controller.environments}
          initialEnvironmentId={controller.selectedEnvironmentId}
          onAdd={(environmentId, workspace) => {
            controller.selectProject(environmentId, workspace);
            setPage("threads");
            setAddProjectOpen(false);
          }}
          onClose={() => setAddProjectOpen(false)}
        />
      ) : null}
    </AppSidebarLayout>
  );
}
