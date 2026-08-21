import { ArchiveIcon, ArchiveRestoreIcon, LoaderIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo } from "react";

import { useOptionalAppServerController } from "../../appServer/context";
import type { ArchivedThread } from "../../appServer/useAppServerController";
import { readLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

function timestamp(value: number): Date {
  return new Date(value > 0 && value < 10_000_000_000 ? value * 1_000 : value);
}

export function AppServerArchivedThreads() {
  const controller = useOptionalAppServerController();

  useEffect(() => {
    void controller?.refreshArchivedThreads();
  }, [controller]);

  const groups = useMemo(() => {
    const grouped = new Map<
      string,
      {
        readonly title: string;
        readonly threads: ReadonlyArray<ArchivedThread>;
      }
    >();
    for (const thread of controller?.archivedThreads ?? []) {
      const key = `${thread.environmentId}:${thread.cwd}`;
      const existing = grouped.get(key);
      const threads = [...(existing?.threads ?? []), thread].toSorted(
        (left, right) => right.updatedAt - left.updatedAt,
      );
      grouped.set(key, {
        title: `${thread.cwd} · ${thread.environmentName}`,
        threads,
      });
    }
    return [...grouped.entries()];
  }, [controller?.archivedThreads]);

  if (controller === null) return null;

  const restore = async (environmentId: string, threadId: string) => {
    await controller.unarchiveThread(environmentId, threadId);
  };
  const remove = async (environmentId: string, threadId: string) => {
    if (!window.confirm("Permanently delete this archived thread?")) return;
    await controller.deleteThread(environmentId, threadId);
  };
  const showContextMenu = async (
    environmentId: string,
    threadId: string,
    position: { readonly x: number; readonly y: number },
  ) => {
    const action = await readLocalApi()?.contextMenu.show(
      [
        { id: "restore", label: "Unarchive" },
        { id: "delete", label: "Delete", destructive: true },
      ] as const,
      position,
    );
    if (action === "restore") await restore(environmentId, threadId);
    if (action === "delete") await remove(environmentId, threadId);
  };

  return (
    <SettingsPageContainer>
      {groups.length === 0 ? (
        <SettingsSection title="Archived threads">
          <SettingsRow
            title={
              <span className="inline-flex items-center gap-2">
                {controller.archiveLoading ? (
                  <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <ArchiveIcon className="size-3.5 text-muted-foreground" />
                )}
                {controller.archiveLoading
                  ? "Loading archived threads"
                  : controller.archiveError
                    ? "Could not load archived threads"
                    : "No archived threads"}
              </span>
            }
            description={
              controller.archiveLoading
                ? "Checking every connected app-server."
                : (controller.archiveError ?? "Archived app-server threads will appear here.")
            }
          />
        </SettingsSection>
      ) : (
        groups.map(([key, group]) => (
          <SettingsSection key={key} title={group.title}>
            {group.threads.map((thread) => (
              <SettingsRow
                key={thread.id}
                title={
                  thread.name?.trim() || thread.preview.trim().split("\n")[0] || "Untitled thread"
                }
                description={`Archived ${timestamp(thread.updatedAt).toLocaleString()}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void showContextMenu(thread.environmentId, thread.id, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                control={
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void restore(thread.environmentId, thread.id)}
                    >
                      <ArchiveRestoreIcon /> Unarchive
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete archived thread"
                      onClick={() => void remove(thread.environmentId, thread.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                }
              />
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
