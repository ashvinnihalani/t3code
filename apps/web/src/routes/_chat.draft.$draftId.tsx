import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";
import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import {
  DraftId,
  markPromotedDraftThreadByRef,
  useComposerDraftStore,
} from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";
import { waitForDraftHeroTransition } from "../components/chat/draftHeroTransition";
import { buildThreadRouteParams } from "../threadRoutes";
import { useThread, useThreadRefs } from "../state/entities";
import { useOptionalAppServerController } from "../appServer/context";
import {
  environmentIdFor,
  isNewAppServerThreadSelection,
  projectIdForWorkspace,
} from "../appServer/upstreamAdapter";

function DraftChatThreadRouteView() {
  const appServer = useOptionalAppServerController();
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const threadRefs = useThreadRefs();
  const inferredThreadRef = draftSession
    ? (threadRefs.find(
        (ref) =>
          ref.environmentId === draftSession.environmentId &&
          ref.threadId === draftSession.threadId,
      ) ?? null)
    : null;
  const serverThreadRef = draftSession?.promotedTo ?? inferredThreadRef;
  const serverThread = useThread(serverThreadRef);
  const serverThreadStarted = threadHasStarted(serverThread);
  const canonicalThreadRef = serverThreadStarted ? serverThreadRef : null;
  const directProject = draftSession
    ? appServer?.projects.find(
        (candidate) =>
          candidate.environmentId === draftSession.environmentId &&
          projectIdForWorkspace(candidate.cwd) === draftSession.projectId,
      )
    : undefined;
  const selectAppServerProject = appServer?.selectProject;
  const directDraftBaselineRef = useRef({
    draftId: rawDraftId,
    threadId: appServer?.selectedThreadId ?? null,
  });
  if (directDraftBaselineRef.current.draftId !== rawDraftId) {
    directDraftBaselineRef.current = {
      draftId: rawDraftId,
      threadId: appServer?.selectedThreadId ?? null,
    };
  }

  useEffect(() => {
    if (selectAppServerProject === undefined || directProject === undefined) return;
    selectAppServerProject(directProject.environmentId, directProject.cwd);
  }, [directProject?.cwd, directProject?.environmentId, selectAppServerProject]);

  useEffect(() => {
    if (
      appServer === null ||
      appServer.selectedEnvironmentId === null ||
      !isNewAppServerThreadSelection(
        directDraftBaselineRef.current.threadId,
        appServer.selectedThreadId,
      )
    ) {
      return;
    }
    useComposerDraftStore
      .getState()
      .markDraftThreadPromoting(
        draftId,
        scopeThreadRef(
          environmentIdFor(appServer.selectedEnvironmentId),
          ThreadId.make(appServer.selectedThreadId),
        ),
      );
    void navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: appServer.selectedEnvironmentId,
        threadId: appServer.selectedThreadId,
      },
      replace: true,
    });
  }, [appServer?.selectedEnvironmentId, appServer?.selectedThreadId, draftId, navigate]);

  useEffect(() => {
    if (!inferredThreadRef || draftSession?.promotedTo) {
      return;
    }
    markPromotedDraftThreadByRef(inferredThreadRef);
  }, [draftSession?.promotedTo, inferredThreadRef]);

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }

    let cancelled = false;
    void waitForDraftHeroTransition().then(() => {
      if (cancelled) {
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(canonicalThreadRef),
        replace: true,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [canonicalThreadRef, navigate]);

  useEffect(() => {
    if (draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate]);

  if (!draftSession) {
    return null;
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <ChatView
        draftId={draftId}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        routeKind="draft"
        forceExpandedMobileComposer
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: DraftChatThreadRouteView,
});
