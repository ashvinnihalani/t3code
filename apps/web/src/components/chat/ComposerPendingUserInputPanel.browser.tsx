import { type ApprovalRequestId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";
import type { PendingUserInput } from "../../session-logic";
import type { PendingUserInputDraftAnswer } from "../../pendingUserInput";

const REQUEST_ID = "approval-request-1" as ApprovalRequestId;
const QUESTION_ID = "question-1";

function createPendingUserInput(): PendingUserInput {
  return {
    requestId: REQUEST_ID,
    createdAt: "2026-04-11T00:00:00.000Z",
    questions: [
      {
        id: QUESTION_ID,
        header: "Pick",
        question: "Choose an option",
        options: [
          { label: "Alpha", description: "First option" },
          { label: "Beta", description: "Second option" },
        ],
      },
    ],
  };
}

async function mountPanel(answers: Record<string, PendingUserInputDraftAnswer>) {
  const host = document.createElement("div");
  document.body.append(host);
  const editableRoot = document.createElement("div");
  editableRoot.setAttribute("contenteditable", "true");
  const editableChild = document.createElement("span");
  editableChild.textContent = "focus target";
  editableRoot.append(editableChild);
  document.body.append(editableRoot);

  const onSelectOption = vi.fn();
  const onAdvance = vi.fn();
  const screen = await render(
    <ComposerPendingUserInputPanel
      pendingUserInputs={[createPendingUserInput()]}
      respondingRequestIds={[]}
      answers={answers}
      questionIndex={0}
      onSelectOption={onSelectOption}
      onAdvance={onAdvance}
    />,
    { container: host },
  );

  await vi.waitFor(() => {
    expect(host.querySelector("button")).toBeTruthy();
  });

  return {
    editableChild,
    onSelectOption,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
      editableRoot.remove();
    },
  };
}

function dispatchDigitShortcut(target: HTMLElement, key: string): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("ComposerPendingUserInputPanel keyboard shortcuts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("selects an option from a focused empty contenteditable composer", async () => {
    const mounted = await mountPanel({
      [QUESTION_ID]: {
        customAnswer: "",
      },
    });

    try {
      dispatchDigitShortcut(mounted.editableChild, "2");

      expect(mounted.onSelectOption).toHaveBeenCalledWith(QUESTION_ID, "Beta");
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not hijack number keys after the user has typed a custom answer", async () => {
    const mounted = await mountPanel({
      [QUESTION_ID]: {
        customAnswer: "keep the current rollout",
      },
    });

    try {
      dispatchDigitShortcut(mounted.editableChild, "2");

      expect(mounted.onSelectOption).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });
});
