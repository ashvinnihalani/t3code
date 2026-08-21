import type * as CodexSchema from "effect-codex-app-server/schema";

export type ComposerAccessMode = "supervised" | "auto-accept-edits" | "auto" | "full-access";

export interface ComposerOptions {
  readonly model: string | null;
  readonly effort: string | null;
  readonly serviceTier: string | null;
  readonly access: ComposerAccessMode;
}

export function threadAccessOverrides(access: ComposerAccessMode): {
  readonly approvalPolicy: CodexSchema.ClientRequest__AskForApproval;
  readonly sandbox: CodexSchema.ClientRequest__SandboxMode;
} {
  switch (access) {
    case "supervised":
      return { approvalPolicy: "on-request", sandbox: "read-only" };
    case "auto-accept-edits":
      return { approvalPolicy: "on-request", sandbox: "workspace-write" };
    case "auto":
      return { approvalPolicy: "untrusted", sandbox: "workspace-write" };
    case "full-access":
      return { approvalPolicy: "never", sandbox: "danger-full-access" };
  }
}

export function turnAccessOverrides(access: ComposerAccessMode): {
  readonly approvalPolicy: CodexSchema.ClientRequest__AskForApproval;
  readonly sandboxPolicy: CodexSchema.ClientRequest__SandboxPolicy;
} {
  const thread = threadAccessOverrides(access);
  switch (thread.sandbox) {
    case "read-only":
      return { approvalPolicy: thread.approvalPolicy, sandboxPolicy: { type: "readOnly" } };
    case "workspace-write":
      return { approvalPolicy: thread.approvalPolicy, sandboxPolicy: { type: "workspaceWrite" } };
    case "danger-full-access":
      return {
        approvalPolicy: thread.approvalPolicy,
        sandboxPolicy: { type: "dangerFullAccess" },
      };
  }
}
