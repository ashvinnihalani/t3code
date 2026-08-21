import { createFileRoute } from "@tanstack/react-router";

import { ConnectionsSettings } from "../components/settings/ConnectionsSettings";
import { AppServerConnectionsSettings } from "../components/settings/AppServerConnectionsSettings";
import { isDirectAppServerDesktop } from "../appServer/context";

function ConnectionsRoute() {
  return isDirectAppServerDesktop() ? <AppServerConnectionsSettings /> : <ConnectionsSettings />;
}

export const Route = createFileRoute("/settings/connections")({
  component: ConnectionsRoute,
});
