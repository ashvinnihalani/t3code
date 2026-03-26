import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { memo } from "react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { type VisibleProviderHealthStatus } from "../ChatView.logic";
import { Button } from "../ui/button";

export const ProviderHealthBanner = memo(function ProviderHealthBanner({
  status,
  onDismiss,
}: {
  status: VisibleProviderHealthStatus;
  onDismiss?: () => void;
}) {
  if (!status) {
    return null;
  }

  if (status.kind === "local") {
    if (status.status.status === "ready") {
      return null;
    }

    const providerLabel = PROVIDER_DISPLAY_NAMES[status.status.provider] ?? status.status.provider;
    const defaultMessage =
      status.status.status === "error"
        ? `${providerLabel} provider is unavailable.`
        : `${providerLabel} provider has limited availability.`;

    return (
      <div className="pt-3 mx-auto max-w-3xl">
        <Alert variant={status.status.status === "error" ? "error" : "warning"}>
          <CircleAlertIcon />
          <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <AlertTitle>{`Local ${providerLabel} provider status`}</AlertTitle>
              <AlertDescription
                className="line-clamp-3"
                title={status.status.message ?? defaultMessage}
              >
                {status.status.message ?? defaultMessage}
              </AlertDescription>
            </div>
            {onDismiss ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="-mr-1 -mt-1 shrink-0"
                aria-label="Dismiss provider status"
                onClick={onDismiss}
              >
                <XIcon />
              </Button>
            ) : null}
          </div>
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
