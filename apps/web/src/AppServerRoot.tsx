import { useMemo, useState } from "react";

import { toSettingsDraft, useAppServerController } from "./appServer/useAppServerController";
import { AppSidebarLayout } from "./components/AppSidebarLayout";
import { RemoteDialog } from "./components/RemoteDialog";
import { SidebarV2 } from "./components/SidebarV2";
import { ThreadWorkspace } from "./components/chat/ThreadWorkspace";
import { SettingsPanels } from "./components/settings/SettingsPanels";

type Page = "threads" | "settings";

export function AppServerRoot() {
  const controller = useAppServerController();
  const [page, setPage] = useState<Page>("threads");
  const [remoteOpen, setRemoteOpen] = useState(false);

  const selectedSummary = useMemo(
    () =>
      controller.connection.snapshot?.threads.find(
        (thread) => thread.id === controller.selectedThreadId,
      ) ?? null,
    [controller.connection.snapshot, controller.selectedThreadId],
  );

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
        <SidebarV2
          connection={controller.connection}
          projects={controller.projects}
          selectedThreadId={controller.selectedThreadId}
          settingsActive={page === "settings"}
          onNewThread={openNewThread}
          onOpenSettings={() => setPage("settings")}
          onSelectThread={(threadId) => {
            setPage("threads");
            void controller.selectThread(threadId);
          }}
        />
      }
    >
      {page === "settings" ? (
        <>
          <header className="drag-region flex h-[var(--workspace-topbar-height)] shrink-0 items-center border-b border-border px-5">
            <h1 className="text-sm font-medium">Settings</h1>
          </header>
          <SettingsPanels
            error={controller.settingsError}
            initialDraft={toSettingsDraft(controller.settings)}
            sshHosts={controller.sshHosts}
            onSave={async (draft) => {
              const saved = await controller.saveSettings(draft);
              if (saved) setPage("threads");
              return saved;
            }}
          />
        </>
      ) : (
        <ThreadWorkspace
          actionError={controller.actionError}
          connection={controller.connection}
          loading={controller.threadLoading}
          models={controller.models}
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
