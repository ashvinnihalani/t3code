import { createFileRoute } from "@tanstack/react-router";

import { ArchivedThreadsPanel } from "../components/settings/SettingsPanels";
import { AppServerArchivedThreads } from "../components/settings/AppServerArchivedThreads";
import { isDirectAppServerDesktop } from "../appServer/context";

function ArchivedThreadsRoute() {
  return isDirectAppServerDesktop() ? <AppServerArchivedThreads /> : <ArchivedThreadsPanel />;
}

export const Route = createFileRoute("/settings/archived")({
  component: ArchivedThreadsRoute,
});
