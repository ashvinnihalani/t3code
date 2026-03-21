import { type ProviderInteractionMode } from "@t3tools/contracts";
import { BotIcon, CircleAlertIcon, ListTodoIcon, type LucideIcon } from "lucide-react";

export const INTERACTION_MODE_LABEL_BY_OPTION = {
  default: "Chat",
  plan: "Plan",
  help: "Help",
} as const satisfies Record<ProviderInteractionMode, string>;

export const INTERACTION_MODE_ICON_BY_OPTION = {
  default: BotIcon,
  plan: ListTodoIcon,
  help: CircleAlertIcon,
} as const satisfies Record<ProviderInteractionMode, LucideIcon>;

export function getNextInteractionMode(
  currentMode: ProviderInteractionMode,
  supportedModes: ReadonlyArray<ProviderInteractionMode>,
): ProviderInteractionMode {
  const fallbackMode = supportedModes[0] ?? currentMode;
  const currentIndex = supportedModes.indexOf(currentMode);
  if (currentIndex < 0) {
    return fallbackMode;
  }
  return supportedModes[(currentIndex + 1) % supportedModes.length] ?? fallbackMode;
}
