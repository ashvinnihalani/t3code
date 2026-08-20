import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/providers")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/connections", replace: true });
  },
});
