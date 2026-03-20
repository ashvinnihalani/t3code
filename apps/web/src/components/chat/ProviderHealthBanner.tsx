import { memo } from "react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { CircleAlertIcon } from "lucide-react";
import { type VisibleProviderHealthStatus } from "../ChatView.logic";

export const ProviderHealthBanner = memo(function ProviderHealthBanner({
  status,
}: {
  status: VisibleProviderHealthStatus;
}) {
  if (!status) {
    return null;
  }

  if (status.kind === "local") {
    if (status.status.status === "ready") {
      return null;
    }

    const providerLabel =
      status.status.provider === "codex"
        ? "Codex"
        : status.status.provider === "claudeAgent"
          ? "Claude"
          : "Kiro";
    const defaultMessage =
      status.status.status === "error"
        ? `${providerLabel} provider is unavailable.`
        : `${providerLabel} provider has limited availability.`;

    return (
      <div className="pt-3 mx-auto max-w-3xl">
        <Alert variant={status.status.status === "error" ? "error" : "warning"}>
          <CircleAlertIcon />
          <AlertTitle>{`Local ${providerLabel} provider status`}</AlertTitle>
          <AlertDescription
            className="line-clamp-3"
            title={status.status.message ?? defaultMessage}
          >
            {status.status.message ?? defaultMessage}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant={status.status}>
        <CircleAlertIcon />
        <AlertTitle>{status.title}</AlertTitle>
        <AlertDescription className="line-clamp-3" title={status.message}>
          {status.message}
        </AlertDescription>
      </Alert>
    </div>
  );
});
