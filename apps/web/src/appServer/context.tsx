import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { createContext, type PropsWithChildren, useContext, useEffect } from "react";

import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { RuntimeMode } from "@t3tools/contracts";
import { projectIdForWorkspace } from "./upstreamAdapter";
import { useAppServerController } from "./useAppServerController";
import { isDirectAppServerDesktop } from "./mode";

export { isDirectAppServerDesktop } from "./mode";

export type AppServerController = ReturnType<typeof useAppServerController>;

const AppServerControllerContext = createContext<AppServerController | null>(null);
let activeController: AppServerController | null = null;

function ActiveAppServerProvider({ children }: PropsWithChildren) {
  const controller = useAppServerController();
  activeController = controller;
  useEffect(
    () => () => {
      if (activeController === controller) activeController = null;
    },
    [controller],
  );
  return (
    <AppServerControllerContext.Provider value={controller}>
      {children}
    </AppServerControllerContext.Provider>
  );
}

export function AppServerProvider({ children }: PropsWithChildren) {
  return isDirectAppServerDesktop() ? (
    <ActiveAppServerProvider>{children}</ActiveAppServerProvider>
  ) : (
    children
  );
}

export function useOptionalAppServerController(): AppServerController | null {
  return useContext(AppServerControllerContext);
}

export function readOptionalAppServerController(): AppServerController | null {
  return activeController;
}

function accessMode(runtimeMode: RuntimeMode) {
  return runtimeMode === "approval-required" ? "supervised" : runtimeMode;
}

function modelOption(modelSelection: Record<string, unknown>, optionId: string): string | null {
  const options = modelSelection.options;
  if (!Array.isArray(options)) return null;
  const option = options.find(
    (candidate): candidate is { readonly id: string; readonly value: string } =>
      typeof candidate === "object" &&
      candidate !== null &&
      "id" in candidate &&
      candidate.id === optionId &&
      "value" in candidate &&
      typeof candidate.value === "string",
  );
  return option?.value ?? null;
}

function success(): AtomCommandResult<unknown, unknown> {
  return AsyncResult.success(undefined);
}

function unsupported(label: string): AtomCommandResult<unknown, unknown> {
  return AsyncResult.failure(Cause.fail(new Error(`${label} is not supported by app-server.`)));
}

function failure(message: string): AtomCommandResult<unknown, unknown> {
  return AsyncResult.failure(Cause.fail(new Error(message)));
}

export async function runAppServerCommand(
  controller: AppServerController,
  label: string,
  value: unknown,
): Promise<AtomCommandResult<unknown, unknown>> {
  if (typeof value !== "object" || value === null || !("environmentId" in value)) {
    return unsupported(label);
  }
  const command = value as {
    readonly environmentId: string;
    readonly input?: Record<string, unknown>;
  };
  const input = command.input ?? {};
  const threadId = typeof input.threadId === "string" ? input.threadId : null;

  switch (label) {
    case "environment-data:commands:project:create":
      if (typeof input.workspaceRoot === "string") {
        controller.selectProject(command.environmentId, input.workspaceRoot);
        return success();
      }
      return unsupported(label);
    case "environment-data:commands:project:delete": {
      if (typeof input.projectId !== "string") return unsupported(label);
      const project = controller.projects.find(
        (candidate) =>
          candidate.environmentId === command.environmentId &&
          projectIdForWorkspace(candidate.cwd) === input.projectId,
      );
      return project !== undefined &&
        (await controller.removeProject(command.environmentId, project.cwd))
        ? success()
        : unsupported(label);
    }
    case "environment-data:shell:open-in-editor": {
      const bridge = window.desktopBridge;
      const profile = controller.environments.find(
        (candidate) => candidate.profile.id === command.environmentId,
      )?.profile;
      if (
        profile === undefined ||
        bridge?.openAppServerWorkspace === undefined ||
        typeof input.cwd !== "string" ||
        typeof input.editor !== "string"
      ) {
        return unsupported(label);
      }
      const result = await bridge.openAppServerWorkspace({
        profile,
        cwd: input.cwd,
        editor: input.editor as Parameters<
          NonNullable<typeof bridge.openAppServerWorkspace>
        >[0]["editor"],
      });
      return result.ok ? success() : failure(result.error ?? "Unable to open workspace.");
    }
    case "environment-data:projects:write-file": {
      try {
        return (await controller.writeProjectFile(
          command.environmentId,
          input as Parameters<typeof controller.writeProjectFile>[1],
        ))
          ? success()
          : unsupported(label);
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    }
    case "environment-data:terminal:open":
    case "environment-data:terminal:write":
    case "environment-data:terminal:resize":
    case "environment-data:terminal:clear":
    case "environment-data:terminal:restart":
    case "environment-data:terminal:close": {
      try {
        let handled = false;
        switch (label) {
          case "environment-data:terminal:open":
            handled = await controller.openTerminal(
              command.environmentId,
              input as Parameters<typeof controller.openTerminal>[1],
            );
            break;
          case "environment-data:terminal:write":
            handled = await controller.writeTerminal(
              command.environmentId,
              input as Parameters<typeof controller.writeTerminal>[1],
            );
            break;
          case "environment-data:terminal:resize":
            handled = await controller.resizeTerminal(
              command.environmentId,
              input as Parameters<typeof controller.resizeTerminal>[1],
            );
            break;
          case "environment-data:terminal:clear":
            handled = controller.clearTerminal(
              command.environmentId,
              input as Parameters<typeof controller.clearTerminal>[1],
            );
            break;
          case "environment-data:terminal:restart":
            handled = await controller.restartTerminal(
              command.environmentId,
              input as Parameters<typeof controller.restartTerminal>[1],
            );
            break;
          case "environment-data:terminal:close":
            handled = await controller.closeTerminal(
              command.environmentId,
              input as Parameters<typeof controller.closeTerminal>[1],
            );
            break;
        }
        return handled ? success() : unsupported(label);
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    }
    case "environment-data:commands:thread:create":
      return success();
    case "environment-data:commands:thread:start-turn": {
      const message = input.message;
      if (typeof message !== "object" || message === null || !("text" in message)) {
        return unsupported(label);
      }
      const text = typeof message.text === "string" ? message.text : "";
      const clientMessageId =
        "messageId" in message && typeof message.messageId === "string"
          ? message.messageId
          : undefined;
      const modelSelection = input.modelSelection;
      const selection =
        typeof modelSelection === "object" && modelSelection !== null
          ? (modelSelection as Record<string, unknown>)
          : null;
      const model =
        selection !== null && typeof selection.model === "string" ? selection.model : null;
      const rawRuntimeMode = input.runtimeMode;
      const runtimeMode: RuntimeMode =
        rawRuntimeMode === "approval-required" ||
        rawRuntimeMode === "auto-accept-edits" ||
        rawRuntimeMode === "auto" ||
        rawRuntimeMode === "full-access"
          ? rawRuntimeMode
          : "full-access";
      const options = {
        model,
        effort:
          selection === null
            ? null
            : (modelOption(selection, "reasoningEffort") ?? modelOption(selection, "effort")),
        serviceTier: selection === null ? null : modelOption(selection, "serviceTier"),
        access: accessMode(runtimeMode),
      } as const;
      const started =
        input.bootstrap && threadId !== null
          ? await controller.startThread(text, options, clientMessageId)
          : (await controller.sendTurn(text, options, clientMessageId), threadId);
      return started === null ? unsupported(label) : success();
    }
    case "environment-data:commands:thread:interrupt-turn":
      await controller.interruptTurn();
      return success();
    case "environment-data:commands:thread:archive":
      return threadId !== null && (await controller.archiveThread(command.environmentId, threadId))
        ? success()
        : unsupported(label);
    case "environment-data:commands:thread:delete":
      return threadId !== null && (await controller.deleteThread(command.environmentId, threadId))
        ? success()
        : unsupported(label);
    case "environment-data:commands:thread:update-metadata":
      if (threadId !== null && typeof input.title === "string") {
        return (await controller.renameThread(command.environmentId, threadId, input.title))
          ? success()
          : unsupported(label);
      }
      return success();
    case "environment-data:commands:thread:set-runtime-mode":
    case "environment-data:commands:thread:set-interaction-mode":
      return success();
    case "environment-data:commands:thread:respond-to-approval":
      if (
        typeof input.requestId === "string" &&
        (input.decision === "accept" ||
          input.decision === "acceptForSession" ||
          input.decision === "decline" ||
          input.decision === "cancel")
      ) {
        controller.respondToApproval(input.requestId, input.decision);
        return success();
      }
      return unsupported(label);
    case "environment-data:commands:thread:respond-to-user-input":
      if (
        typeof input.requestId === "string" &&
        typeof input.answers === "object" &&
        input.answers !== null
      ) {
        const answers = Object.fromEntries(
          Object.entries(input.answers).flatMap(([questionId, answer]) =>
            typeof answer === "string" ||
            (Array.isArray(answer) && answer.every((entry) => typeof entry === "string"))
              ? [[questionId, answer as string | ReadonlyArray<string>]]
              : [],
          ),
        );
        controller.respondToUserInput(input.requestId, answers);
        return success();
      }
      return unsupported(label);
    default:
      return unsupported(label);
  }
}
