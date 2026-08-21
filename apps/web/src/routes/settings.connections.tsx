import { createFileRoute } from "@tanstack/react-router";

import { AppServerConnectionsSettings } from "../components/settings/AppServerConnectionsSettings";

function ConnectionsRoute() {
  return <AppServerConnectionsSettings />;
}

export const Route = createFileRoute("/settings/connections")({
  component: ConnectionsRoute,
});
