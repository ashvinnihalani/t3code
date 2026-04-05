/**
 * Server - HTTP/WebSocket server service interface.
 *
 * Owns startup and shutdown lifecycle of the HTTP server, static asset serving,
 * and WebSocket request routing.
 *
 * @module Server
 */
import http from "node:http";
import fs from "node:fs/promises";
import nodePath from "node:path";
import type { Duplex } from "node:stream";

import Mime from "@effect/platform-node/Mime";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ClientOrchestrationCommand,
  type OrchestrationCommand,
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  ProjectId,
  ThreadId,
  WS_CHANNELS,
  WS_METHODS,
  WebSocketRequest,
  type WsResponse as WsResponseMessage,
  WsResponse,
  type WsPushEnvelopeBase,
} from "@t3tools/contracts";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  Cause,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  Ref,
  Result,
  Schema,
  Scope,
  ServiceMap,
  Stream,
  Struct,
} from "effect";
import { WebSocketServer, type WebSocket } from "ws";

import { createLogger } from "./logger";
import { GitManager } from "./git/Services/GitManager.ts";
import { TerminalManager } from "./terminal/Services/Manager.ts";
import { Keybindings } from "./keybindings";
import { searchWorkspaceEntries } from "./workspaceEntries";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { OrchestrationReactor } from "./orchestration/Services/OrchestrationReactor";
import { ProviderService } from "./provider/Services/ProviderService";
import { ProviderHealth } from "./provider/Services/ProviderHealth";
import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { clamp } from "effect/Number";
import { Open, resolveAvailableEditors } from "./open";
import { ServerConfig } from "./config";
import { GitCore } from "./git/Services/GitCore.ts";
import { tryHandleProjectFaviconRequest } from "./projectFaviconRoute";

import {
  createAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
} from "./attachmentStore.ts";
import { parseBase64DataUrl } from "./imageMime.ts";
import { expandHomePath } from "./os-jank.ts";
import { makeServerPushBus } from "./wsServer/pushBus.ts";
import { makeServerReadiness } from "./wsServer/readiness.ts";
import { decodeJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";
import { listSshHosts } from "./sshHosts";
import { validateRemoteProjectOverSsh } from "./remote/validateRemoteProject";
import { buildSshExecArgs, quotePosixShell, readRemoteHomeDir } from "./sshCommand";
import { runProcess } from "./processRunner";

/**
 * ServerShape - Service API for server lifecycle control.
 */
export interface ServerShape {
  /**
   * Start HTTP and WebSocket listeners.
   */
  readonly start: Effect.Effect<
    http.Server,
    ServerLifecycleError,
    Scope.Scope | ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
  >;

  /**
   * Wait for process shutdown signals.
   */
  readonly stopSignal: Effect.Effect<void, never>;
}

/**
 * Server - Service tag for HTTP/WebSocket lifecycle management.
 */
export class Server extends ServiceMap.Service<Server, ServerShape>()("t3/wsServer/Server") {}

const isServerNotRunningError = (error: Error): boolean => {
  const maybeCode = (error as NodeJS.ErrnoException).code;
  return (
    maybeCode === "ERR_SERVER_NOT_RUNNING" || error.message.toLowerCase().includes("not running")
  );
};

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusCode === 401 ? "Unauthorized" : "Bad Request"}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain\r\n" +
      `Content-Length: ${Buffer.byteLength(message)}\r\n` +
      "\r\n" +
      message,
  );
}

function websocketRawToString(raw: unknown): string | null {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw).toString("utf8");
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw)).toString("utf8");
  }
  if (Array.isArray(raw)) {
    const chunks: string[] = [];
    for (const chunk of raw) {
      if (typeof chunk === "string") {
        chunks.push(chunk);
        continue;
      }
      if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk).toString("utf8"));
        continue;
      }
      if (chunk instanceof ArrayBuffer) {
        chunks.push(Buffer.from(new Uint8Array(chunk)).toString("utf8"));
        continue;
      }
      return null;
    }
    return chunks.join("");
  }
  return null;
}

function toPosixRelativePath(input: string): string {
  return input.replaceAll("\\", "/");
}

function resolveWorkspaceRelativePath(params: {
  workspaceRoot: string;
  relativePath: string;
  path: Path.Path;
  label: string;
  allowWorkspaceRoot?: boolean;
}): Effect.Effect<{ absolutePath: string; relativePath: string }, RouteRequestError> {
  const normalizedInputPath = params.relativePath.trim();
  if (params.path.isAbsolute(normalizedInputPath)) {
    return Effect.fail(
      new RouteRequestError({
        message: `${params.label} must be relative to the project root.`,
      }),
    );
  }

  const absolutePath = params.path.resolve(params.workspaceRoot, normalizedInputPath);
  const relativeToRoot = toPosixRelativePath(
    params.path.relative(params.workspaceRoot, absolutePath),
  );
  const isWorkspaceRoot = relativeToRoot.length === 0 || relativeToRoot === ".";
  if (
    (!params.allowWorkspaceRoot && isWorkspaceRoot) ||
    relativeToRoot.startsWith("../") ||
    relativeToRoot === ".." ||
    params.path.isAbsolute(relativeToRoot)
  ) {
    return Effect.fail(
      new RouteRequestError({
        message: `${params.label} must stay within the project root.`,
      }),
    );
  }

  return Effect.succeed({
    absolutePath,
    relativePath: isWorkspaceRoot ? "." : relativeToRoot,
  });
}

function resolveRemoteWorkspaceRelativePath(params: {
  workspaceRoot: string;
  relativePath: string;
  label: string;
  allowWorkspaceRoot?: boolean;
}): Effect.Effect<{ absolutePath: string; relativePath: string }, RouteRequestError> {
  const normalizedInputPath = params.relativePath.trim();
  if (nodePath.posix.isAbsolute(normalizedInputPath)) {
    return Effect.fail(
      new RouteRequestError({
        message: `${params.label} must be relative to the project root.`,
      }),
    );
  }

  const absolutePath = nodePath.posix.resolve(params.workspaceRoot, normalizedInputPath);
  const relativeToRoot = nodePath.posix.relative(params.workspaceRoot, absolutePath);
  const isWorkspaceRoot = relativeToRoot.length === 0 || relativeToRoot === ".";
  if (
    (!params.allowWorkspaceRoot && isWorkspaceRoot) ||
    relativeToRoot.startsWith("../") ||
    relativeToRoot === ".." ||
    nodePath.posix.isAbsolute(relativeToRoot)
  ) {
    return Effect.fail(
      new RouteRequestError({
        message: `${params.label} must stay within the project root.`,
      }),
    );
  }

  return Effect.succeed({
    absolutePath,
    relativePath: isWorkspaceRoot ? "." : relativeToRoot,
  });
}

const PROJECT_THREAD_ATTACHMENT_ROUTE_PARTS = ["api", "projects"] as const;

function decodeUrlPathSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function parseProjectThreadAttachmentPath(pathname: string): {
  projectId: string;
  threadId: string;
  attachmentId: string;
} | null {
  const parts = pathname.split("/").filter((segment) => segment.length > 0);
  if (
    parts.length !== 7 ||
    parts[0] !== PROJECT_THREAD_ATTACHMENT_ROUTE_PARTS[0] ||
    parts[1] !== PROJECT_THREAD_ATTACHMENT_ROUTE_PARTS[1] ||
    parts[3] !== "threads" ||
    parts[5] !== "attachments"
  ) {
    return null;
  }

  const projectId = decodeUrlPathSegment(parts[2] ?? "");
  const threadId = decodeUrlPathSegment(parts[4] ?? "");
  const attachmentId = decodeUrlPathSegment(parts[6] ?? "");
  if (!projectId || !threadId || !attachmentId) {
    return null;
  }

  return { projectId, threadId, attachmentId };
}

function stripRequestTag<T extends { _tag: string }>(body: T) {
  return Struct.omit(body, ["_tag"]);
}

const encodeWsResponse = Schema.encodeEffect(Schema.fromJsonString(WsResponse));
const decodeWebSocketRequest = decodeJsonResult(WebSocketRequest);

export type ServerCoreRuntimeServices =
  | OrchestrationEngineService
  | ProjectionSnapshotQuery
  | CheckpointDiffQuery
  | OrchestrationReactor
  | ProviderService
  | ProviderHealth;

export type ServerRuntimeServices =
  | ServerCoreRuntimeServices
  | GitManager
  | GitCore
  | TerminalManager
  | Keybindings
  | Open;

export class ServerLifecycleError extends Schema.TaggedErrorClass<ServerLifecycleError>()(
  "ServerLifecycleError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

class RouteRequestError extends Schema.TaggedErrorClass<RouteRequestError>()("RouteRequestError", {
  message: Schema.String,
}) {}

function formatRouteFailureMessage(cause: Cause.Cause<unknown>): string {
  const squashed = Cause.squash(cause);
  if (squashed instanceof Error) {
    const message = squashed.message.trim();
    if (message.length > 0) {
      return message;
    }
  }
  return Cause.pretty(cause);
}

function hasAuthorizedDesktopRequest(
  req: http.IncomingMessage,
  authToken: string | undefined,
): boolean {
  if (!authToken) {
    return true;
  }

  const rawHeader = req.headers["x-t3code-auth-token"];
  const providedToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  return providedToken === authToken;
}

function readJsonRequestBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const maxBytes = 16 * 1024;

    req.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        reject(new Error("Request body too large."));
        return;
      }
      chunks.push(buffer);
    });

    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        resolve(text.length > 0 ? (JSON.parse(text) as unknown) : null);
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

export const createServer = Effect.fn(function* (): Effect.fn.Return<
  http.Server,
  ServerLifecycleError,
  Scope.Scope | ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
> {
  const serverConfig = yield* ServerConfig;
  const {
    port,
    cwd,
    keybindingsConfigPath,
    staticDir,
    devUrl,
    authToken,
    host,
    logWebSocketEvents,
    autoBootstrapProjectFromCwd,
  } = serverConfig;
  const availableEditors = resolveAvailableEditors();

  const gitManager = yield* GitManager;
  const terminalManager = yield* TerminalManager;
  const keybindingsManager = yield* Keybindings;
  const providerHealth = yield* ProviderHealth;
  const git = yield* GitCore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* keybindingsManager.syncDefaultKeybindingsOnStartup.pipe(
    Effect.catch((error) =>
      Effect.logWarning("failed to sync keybindings defaults on startup", {
        path: error.configPath,
        detail: error.detail,
        cause: error.cause,
      }),
    ),
  );

  const providerStatuses = yield* providerHealth.getStatuses;

  const clients = yield* Ref.make(new Set<WebSocket>());
  const logger = createLogger("ws");
  const readiness = yield* makeServerReadiness;

  function logOutgoingPush(push: WsPushEnvelopeBase, recipients: number) {
    if (!logWebSocketEvents) return;
    logger.event("outgoing push", {
      channel: push.channel,
      sequence: push.sequence,
      recipients,
      payload: push.data,
    });
  }

  const pushBus = yield* makeServerPushBus({
    clients,
    logOutgoingPush,
  });
  yield* readiness.markPushBusReady;
  yield* keybindingsManager.start.pipe(
    Effect.mapError(
      (cause) => new ServerLifecycleError({ operation: "keybindingsRuntimeStart", cause }),
    ),
  );
  yield* readiness.markKeybindingsReady;

  const normalizeDispatchCommand = Effect.fnUntraced(function* (input: {
    readonly command: ClientOrchestrationCommand;
  }) {
    const normalizeProjectWorkspaceRoot = Effect.fnUntraced(function* (input: {
      readonly workspaceRoot: string;
      readonly remote?: { readonly kind: "ssh"; readonly hostAlias: string } | null;
    }) {
      if (input.remote?.kind === "ssh") {
        return input.workspaceRoot.trim();
      }

      const normalizedWorkspaceRoot = path.resolve(
        yield* expandHomePath(input.workspaceRoot.trim()),
      );
      const workspaceStat = yield* fileSystem
        .stat(normalizedWorkspaceRoot)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!workspaceStat) {
        return yield* new RouteRequestError({
          message: `Project directory does not exist: ${normalizedWorkspaceRoot}`,
        });
      }
      if (workspaceStat.type !== "Directory") {
        return yield* new RouteRequestError({
          message: `Project path is not a directory: ${normalizedWorkspaceRoot}`,
        });
      }
      return normalizedWorkspaceRoot;
    });

    if (input.command.type === "project.create") {
      return {
        ...input.command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot({
          workspaceRoot: input.command.workspaceRoot,
          remote: input.command.remote ?? null,
        }),
      } satisfies OrchestrationCommand;
    }

    if (input.command.type === "project.meta.update" && input.command.workspaceRoot !== undefined) {
      return {
        ...input.command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot({
          workspaceRoot: input.command.workspaceRoot,
          remote: input.command.remote ?? null,
        }),
      } satisfies OrchestrationCommand;
    }

    if (input.command.type !== "thread.turn.start") {
      return input.command as OrchestrationCommand;
    }
    const turnStartCommand = input.command;

    const normalizedAttachments = yield* Effect.forEach(
      turnStartCommand.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          const parsed = parseBase64DataUrl(attachment.dataUrl);
          if (!parsed || !parsed.mimeType.startsWith("image/")) {
            return yield* new RouteRequestError({
              message: `Invalid image attachment payload for '${attachment.name}'.`,
            });
          }

          const bytes = Buffer.from(parsed.base64, "base64");
          if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
            return yield* new RouteRequestError({
              message: `Image attachment '${attachment.name}' is empty or too large.`,
            });
          }

          const attachmentId = createAttachmentId(turnStartCommand.threadId);
          if (!attachmentId) {
            return yield* new RouteRequestError({
              message: "Failed to create a safe attachment id.",
            });
          }

          const persistedAttachment = {
            type: "image" as const,
            id: attachmentId,
            name: attachment.name,
            mimeType: parsed.mimeType.toLowerCase(),
            sizeBytes: bytes.byteLength,
          };

          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment: persistedAttachment,
          });
          if (!attachmentPath) {
            return yield* new RouteRequestError({
              message: `Failed to resolve persisted path for '${attachment.name}'.`,
            });
          }

          yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
            Effect.mapError(
              () =>
                new RouteRequestError({
                  message: `Failed to create attachment directory for '${attachment.name}'.`,
                }),
            ),
          );
          yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
            Effect.mapError(
              () =>
                new RouteRequestError({
                  message: `Failed to persist attachment '${attachment.name}'.`,
                }),
            ),
          );

          return persistedAttachment;
        }),
      { concurrency: 1 },
    );

    return {
      ...turnStartCommand,
      message: {
        ...turnStartCommand.message,
        attachments: normalizedAttachments,
      },
    } satisfies OrchestrationCommand;
  });

  // HTTP server — serves static files or redirects to Vite dev server
  const httpServer = http.createServer((req, res) => {
    const respond = (
      statusCode: number,
      headers: Record<string, string>,
      body?: string | Uint8Array,
    ) => {
      res.writeHead(statusCode, headers);
      res.end(body);
    };
    const respondJson = (statusCode: number, body: unknown) =>
      respond(statusCode, { "Content-Type": "application/json" }, JSON.stringify(body));

    void Effect.runPromise(
      Effect.gen(function* () {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        if (url.pathname === "/api/desktop/runtime") {
          if (!hasAuthorizedDesktopRequest(req, authToken)) {
            respondJson(401, { ok: false, error: "Unauthorized" });
            return;
          }

          if (req.method === "GET") {
            respondJson(200, {
              ok: true,
              mode: serverConfig.mode,
              pid: process.pid,
            });
            return;
          }

          if (req.method === "POST") {
            const bodyExit = yield* Effect.promise(() => readJsonRequestBody(req)).pipe(
              Effect.exit,
            );
            if (Exit.isFailure(bodyExit)) {
              respondJson(400, { ok: false, error: "Invalid JSON body" });
              return;
            }
            const body = bodyExit.value;

            const action =
              typeof body === "object" && body !== null && "action" in body
                ? (body as { action?: unknown }).action
                : undefined;

            if (action === "stop-local-sessions") {
              const snapshot = yield* projectionReadModelQuery.getSnapshot();
              const projectsById = new Map(
                snapshot.projects.map((project) => [project.id, project]),
              );
              const localThreadIds = snapshot.threads
                .filter((thread) => {
                  if (thread.deletedAt !== null || thread.session === null) {
                    return false;
                  }
                  if (thread.session.status === "stopped") {
                    return false;
                  }
                  const project = projectsById.get(thread.projectId);
                  return project?.deletedAt === null && project.remote == null;
                })
                .map((thread) => thread.id);

              const createdAt = new Date().toISOString();
              yield* Effect.forEach(localThreadIds, (threadId) =>
                orchestrationEngine.dispatch({
                  type: "thread.session.stop",
                  commandId: CommandId.makeUnsafe(crypto.randomUUID()),
                  threadId,
                  createdAt,
                }),
              ).pipe(Effect.asVoid);

              respondJson(200, {
                ok: true,
                stoppedThreadIds: localThreadIds,
              });
              return;
            }

            if (action === "shutdown-server") {
              respondJson(200, { ok: true, shuttingDown: true });
              setImmediate(() => {
                process.kill(process.pid, "SIGTERM");
              });
              return;
            }

            respondJson(400, { ok: false, error: "Unsupported action" });
            return;
          }

          respondJson(405, { ok: false, error: "Method not allowed" });
          return;
        }

        const attachmentRequest = parseProjectThreadAttachmentPath(url.pathname);
        const snapshot =
          url.pathname === "/api/project-favicon" || attachmentRequest !== null
            ? yield* projectionReadModelQuery.getSnapshot()
            : null;
        if (
          snapshot &&
          tryHandleProjectFaviconRequest({
            url,
            res,
            resolveProject: (projectId) => {
              const project =
                snapshot.projects.find(
                  (entry) => entry.id === projectId && entry.deletedAt === null,
                ) ?? null;
              if (!project) {
                return null;
              }
              return {
                workspaceRoot: project.workspaceRoot,
                ...(project.remote !== undefined ? { remote: project.remote } : {}),
              };
            },
          })
        ) {
          return;
        }

        if (attachmentRequest && snapshot) {
          const project = snapshot.projects.find(
            (entry) => entry.id === attachmentRequest.projectId && entry.deletedAt === null,
          );
          if (!project) {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }

          const thread = snapshot.threads.find(
            (entry) =>
              entry.id === attachmentRequest.threadId &&
              entry.projectId === project.id &&
              entry.deletedAt === null,
          );
          if (!thread) {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }

          const hasAttachment = thread.messages.some((message) =>
            (message.attachments ?? []).some(
              (attachment) => attachment.id === attachmentRequest.attachmentId,
            ),
          );
          if (!hasAttachment) {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }

          const filePath = resolveAttachmentPathById({
            attachmentsDir: serverConfig.attachmentsDir,
            attachmentId: attachmentRequest.attachmentId,
          });
          if (!filePath) {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }

          const fileInfo = yield* fileSystem
            .stat(filePath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!fileInfo || fileInfo.type !== "File") {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }

          const contentType = Mime.getType(filePath) ?? "application/octet-stream";
          res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          });
          const streamExit = yield* Stream.runForEach(fileSystem.stream(filePath), (chunk) =>
            Effect.sync(() => {
              if (!res.destroyed) {
                res.write(chunk);
              }
            }),
          ).pipe(Effect.exit);
          if (Exit.isFailure(streamExit)) {
            if (!res.destroyed) {
              res.destroy();
            }
            return;
          }
          if (!res.writableEnded) {
            res.end();
          }
          return;
        }

        // In dev mode, redirect to Vite dev server
        if (devUrl) {
          respond(302, { Location: devUrl.href });
          return;
        }

        // Serve static files from the web app build
        if (!staticDir) {
          respond(
            503,
            { "Content-Type": "text/plain" },
            "No static directory configured and no dev URL set.",
          );
          return;
        }

        const staticRoot = path.resolve(staticDir);
        const staticRequestPath = url.pathname === "/" ? "/index.html" : url.pathname;
        const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
        const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
        const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
        const hasPathTraversalSegment = staticRelativePath.startsWith("..");
        if (
          staticRelativePath.length === 0 ||
          hasRawLeadingParentSegment ||
          hasPathTraversalSegment ||
          staticRelativePath.includes("\0")
        ) {
          respond(400, { "Content-Type": "text/plain" }, "Invalid static file path");
          return;
        }

        const isWithinStaticRoot = (candidate: string) =>
          candidate === staticRoot ||
          candidate.startsWith(
            staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`,
          );

        let filePath = path.resolve(staticRoot, staticRelativePath);
        if (!isWithinStaticRoot(filePath)) {
          respond(400, { "Content-Type": "text/plain" }, "Invalid static file path");
          return;
        }

        const ext = path.extname(filePath);
        if (!ext) {
          filePath = path.resolve(filePath, "index.html");
          if (!isWithinStaticRoot(filePath)) {
            respond(400, { "Content-Type": "text/plain" }, "Invalid static file path");
            return;
          }
        }

        const fileInfo = yield* fileSystem
          .stat(filePath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!fileInfo || fileInfo.type !== "File") {
          const indexPath = path.resolve(staticRoot, "index.html");
          const indexData = yield* fileSystem
            .readFile(indexPath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!indexData) {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }
          respond(200, { "Content-Type": "text/html; charset=utf-8" }, indexData);
          return;
        }

        const contentType = Mime.getType(filePath) ?? "application/octet-stream";
        const data = yield* fileSystem
          .readFile(filePath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!data) {
          respond(500, { "Content-Type": "text/plain" }, "Internal Server Error");
          return;
        }
        respond(200, { "Content-Type": contentType }, data);
      }),
    ).catch(() => {
      if (!res.headersSent) {
        respond(500, { "Content-Type": "text/plain" }, "Internal Server Error");
      }
    });
  });

  // WebSocket server — upgrades from the HTTP server
  const wss = new WebSocketServer({ noServer: true });

  const closeWebSocketServer = Effect.callback<void, ServerLifecycleError>((resume) => {
    wss.close((error) => {
      if (error && !isServerNotRunningError(error)) {
        resume(
          Effect.fail(
            new ServerLifecycleError({ operation: "closeWebSocketServer", cause: error }),
          ),
        );
      } else {
        resume(Effect.void);
      }
    });
  });

  const closeAllClients = Ref.get(clients).pipe(
    Effect.flatMap(Effect.forEach((client) => Effect.sync(() => client.close()))),
    Effect.flatMap(() => Ref.set(clients, new Set())),
  );

  const listenOptions = host ? { host, port } : { port };

  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionReadModelQuery = yield* ProjectionSnapshotQuery;
  const resolveProject = Effect.fnUntraced(function* (projectId: ProjectId) {
    const snapshot = yield* projectionReadModelQuery.getSnapshot();
    const project = snapshot.projects.find(
      (entry) => entry.id === projectId && entry.deletedAt === null,
    );
    if (!project) {
      return yield* new RouteRequestError({
        message: `Project '${projectId}' was not found.`,
      });
    }
    return project;
  });

  const resolveThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const snapshot = yield* projectionReadModelQuery.getSnapshot();
    const thread = snapshot.threads.find(
      (entry) => entry.id === threadId && entry.deletedAt === null,
    );
    if (!thread) {
      return yield* new RouteRequestError({
        message: `Thread '${threadId}' was not found.`,
      });
    }
    return thread;
  });

  const resolveProjectPathBase = Effect.fnUntraced(function* (input: {
    readonly projectId: ProjectId;
    readonly threadId?: ThreadId;
  }) {
    const project = yield* resolveProject(input.projectId);
    if (!input.threadId) {
      return {
        project,
        baseRoot: project.workspaceRoot,
      };
    }

    const thread = yield* resolveThread(input.threadId);
    if (thread.projectId !== project.id) {
      return yield* new RouteRequestError({
        message: `Thread '${input.threadId}' does not belong to project '${input.projectId}'.`,
      });
    }

    return {
      project,
      baseRoot: thread.projectPath,
    };
  });

  const resolveProjectEditorTarget = Effect.fnUntraced(function* (input: {
    readonly projectId: ProjectId;
    readonly threadId?: ThreadId;
    readonly relativePath?: string;
    readonly line?: number;
    readonly column?: number;
  }) {
    const { project, baseRoot } = yield* resolveProjectPathBase({
      projectId: input.projectId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
    });
    const relativePath = input.relativePath ?? ".";
    if (project.remote?.kind === "ssh") {
      const resolvedTarget = yield* resolveRemoteWorkspaceRelativePath({
        workspaceRoot: baseRoot,
        relativePath,
        label: "Project path",
        allowWorkspaceRoot: true,
      });
      return {
        kind: "remote-ssh" as const,
        hostAlias: project.remote.hostAlias,
        path: resolvedTarget.absolutePath,
        isDirectory: relativePath === ".",
        ...(typeof input.line === "number" ? { line: input.line } : {}),
        ...(typeof input.column === "number" ? { column: input.column } : {}),
      };
    }

    const resolvedTarget = yield* resolveWorkspaceRelativePath({
      workspaceRoot: baseRoot,
      relativePath,
      path,
      label: "Project path",
      allowWorkspaceRoot: true,
    });
    if (typeof input.line !== "number") {
      return resolvedTarget.absolutePath;
    }
    return `${resolvedTarget.absolutePath}:${input.line}${
      typeof input.column === "number" ? `:${input.column}` : ""
    }`;
  });

  const resolveProjectRemote = Effect.fnUntraced(function* (projectId?: ProjectId) {
    if (!projectId) {
      return null;
    }
    const project = yield* resolveProject(projectId);
    return project.remote ?? null;
  });

  const resolveGitOperationTarget = Effect.fnUntraced(function* (input: {
    readonly repoPath: string;
    readonly projectId?: ProjectId;
    readonly operation: string;
  }) {
    const repoPath = input.repoPath.trim();
    if (repoPath.length === 0) {
      return yield* new RouteRequestError({
        message: `${input.operation} requires a repository path.`,
      });
    }

    if (!input.projectId) {
      return {
        cwd: repoPath,
        remote: null,
      };
    }

    const project = yield* resolveProject(input.projectId);
    return {
      cwd: repoPath,
      remote: project.remote ?? null,
    };
  });

  const resolveProjectRepoRelativePath = Effect.fnUntraced(function* (input: {
    readonly projectId: ProjectId;
    readonly repoPath: string;
  }) {
    const project = yield* resolveProject(input.projectId);
    if (project.gitMode !== "multi") {
      return null;
    }
    const normalizedRepoPath = input.repoPath.trim().replaceAll("\\", "/");
    for (const repo of project.gitRepos ?? []) {
      const absoluteRepoPath =
        project.remote?.kind === "ssh"
          ? nodePath.posix.join(project.workspaceRoot, repo.repoPath)
          : path.join(project.workspaceRoot, repo.repoPath);
      if (absoluteRepoPath.replaceAll("\\", "/") === normalizedRepoPath) {
        return repo.repoPath;
      }
    }
    return null;
  });

  const resolveSyntheticParentPath = (input: {
    readonly requestedWorktreePath: string;
    readonly repoPath: string;
  }) => {
    const repoSegments = input.repoPath.split("/").filter((segment) => segment.length > 0);
    if (repoSegments.length === 0) {
      return input.requestedWorktreePath;
    }

    let absoluteWorktreePath = input.requestedWorktreePath;
    if (!nodePath.isAbsolute(absoluteWorktreePath)) {
      absoluteWorktreePath = nodePath.join(serverConfig.worktreesDir, absoluteWorktreePath);
    }

    let syntheticParentPath = absoluteWorktreePath;
    for (let index = 0; index < repoSegments.length; index += 1) {
      syntheticParentPath = nodePath.dirname(syntheticParentPath);
    }
    return syntheticParentPath;
  };

  const ensureLocalSyntheticParentExtras = Effect.fnUntraced(function* (input: {
    readonly workspaceRoot: string;
    readonly syntheticParentPath: string;
    readonly repoRootNames: ReadonlySet<string>;
  }) {
    yield* Effect.tryPromise(() =>
      fs.mkdir(input.syntheticParentPath, {
        recursive: true,
      }),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new RouteRequestError({
            message:
              cause instanceof Error && cause.message.length > 0
                ? cause.message
                : "Failed to create the synthetic worktree parent directory.",
          }),
      ),
    );

    const entries = yield* Effect.tryPromise(() =>
      fs.readdir(input.workspaceRoot, { withFileTypes: true }),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new RouteRequestError({
            message:
              cause instanceof Error && cause.message.length > 0
                ? cause.message
                : "Failed to read project root entries.",
          }),
      ),
    );

    for (const entry of entries) {
      if (entry.name === ".git" || input.repoRootNames.has(entry.name)) {
        continue;
      }

      const sourcePath = nodePath.join(input.workspaceRoot, entry.name);
      const destinationPath = nodePath.join(input.syntheticParentPath, entry.name);
      yield* Effect.tryPromise(() =>
        fs.cp(sourcePath, destinationPath, {
          recursive: true,
          force: false,
          errorOnExist: false,
          preserveTimestamps: true,
        }),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new RouteRequestError({
              message:
                cause instanceof Error && cause.message.length > 0
                  ? cause.message
                  : `Failed to copy '${entry.name}' into the synthetic worktree parent.`,
            }),
        ),
      );
    }
  });

  const ensureRemoteSyntheticParentExtras = Effect.fnUntraced(function* (input: {
    readonly workspaceRoot: string;
    readonly syntheticParentPath: string;
    readonly hostAlias: string;
    readonly repoRootNames: ReadonlySet<string>;
  }) {
    const skipConditions = [...input.repoRootNames, ".git"].map(
      (name) => `[ "$name" = ${quotePosixShell(name)} ]`,
    );
    const script = [
      `source_root=${quotePosixShell(input.workspaceRoot)}`,
      `target_root=${quotePosixShell(input.syntheticParentPath)}`,
      'mkdir -p "$target_root"',
      'for child in "$source_root"/* "$source_root"/.[!.]* "$source_root"/..?*; do',
      '  [ -e "$child" ] || continue',
      "  name=${child##*/}",
      ...(skipConditions.length > 0
        ? [`  if ${skipConditions.join(" || ")}; then continue; fi`]
        : []),
      '  target="$target_root/$name"',
      '  [ -e "$target" ] && continue',
      '  cp -R "$child" "$target"',
      "done",
    ].join("\n");

    yield* Effect.tryPromise(() =>
      runProcess(
        "ssh",
        buildSshExecArgs({
          hostAlias: input.hostAlias,
          command: "sh",
          args: ["-lc", script],
          localCwd: process.cwd(),
        }),
        {
          cwd: process.cwd(),
          timeoutMs: 30_000,
          outputMode: "truncate",
        },
      ),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new RouteRequestError({
            message:
              cause instanceof Error && cause.message.length > 0
                ? cause.message
                : "Failed to copy project root entries into the remote synthetic worktree parent.",
          }),
      ),
    );
  });

  const ensureSyntheticParentExtras = Effect.fnUntraced(function* (input: {
    readonly projectId?: ProjectId;
    readonly repoPath?: string;
    readonly requestedWorktreePath: string | null;
  }) {
    if (!input.projectId || !input.requestedWorktreePath) {
      return;
    }

    const project = yield* resolveProject(input.projectId);
    if (project.gitMode !== "multi" || !project.gitRepos || project.gitRepos.length === 0) {
      return;
    }

    const repoPath = input.repoPath?.trim();
    if (!repoPath) {
      return;
    }

    const repoExists = project.gitRepos.some((repo) => repo.repoPath === repoPath);
    if (!repoExists) {
      return;
    }

    const repoRootNames = new Set(
      project.gitRepos
        .map((repo) => repo.repoPath.split("/")[0]?.trim() ?? "")
        .filter((name) => name.length > 0),
    );

    if (project.remote?.kind === "ssh") {
      const remoteHomeDir =
        readRemoteHomeDir({
          hostAlias: project.remote.hostAlias,
          localCwd: process.cwd(),
        }) ?? "/tmp";
      const absoluteWorktreePath = nodePath.posix.isAbsolute(input.requestedWorktreePath)
        ? input.requestedWorktreePath
        : nodePath.posix.join(remoteHomeDir, ".t3", "worktrees", input.requestedWorktreePath);
      const repoSegments = repoPath.split("/").filter((segment) => segment.length > 0);
      let syntheticParentPath = absoluteWorktreePath;
      for (let index = 0; index < repoSegments.length; index += 1) {
        syntheticParentPath = nodePath.posix.dirname(syntheticParentPath);
      }
      yield* ensureRemoteSyntheticParentExtras({
        workspaceRoot: project.workspaceRoot,
        syntheticParentPath,
        hostAlias: project.remote.hostAlias,
        repoRootNames,
      });
      return;
    }

    yield* ensureLocalSyntheticParentExtras({
      workspaceRoot: project.workspaceRoot,
      syntheticParentPath: resolveSyntheticParentPath({
        requestedWorktreePath: input.requestedWorktreePath,
        repoPath,
      }),
      repoRootNames,
    });
  });

  const resolveLocalProjectWorkspaceRoot = Effect.fnUntraced(function* (input: {
    readonly projectId: ProjectId;
    readonly operation: string;
  }) {
    const project = yield* resolveProject(input.projectId);
    if (project.remote) {
      return yield* new RouteRequestError({
        message: `${input.operation} is unavailable for remote projects.`,
      });
    }
    return project.workspaceRoot;
  });
  const checkpointDiffQuery = yield* CheckpointDiffQuery;
  const orchestrationReactor = yield* OrchestrationReactor;
  const { openInEditor } = yield* Open;

  const subscriptionsScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(subscriptionsScope, Exit.void));

  yield* Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
    pushBus.publishAll(ORCHESTRATION_WS_CHANNELS.domainEvent, event),
  ).pipe(Effect.forkIn(subscriptionsScope));

  yield* Stream.runForEach(keybindingsManager.streamChanges, (event) =>
    pushBus.publishAll(WS_CHANNELS.serverConfigUpdated, {
      issues: event.issues,
      providers: providerStatuses,
    }),
  ).pipe(Effect.forkIn(subscriptionsScope));

  yield* Scope.provide(orchestrationReactor.start, subscriptionsScope);
  yield* readiness.markOrchestrationSubscriptionsReady;

  let welcomeBootstrapProjectId: ProjectId | undefined;
  let welcomeBootstrapThreadId: ThreadId | undefined;

  if (autoBootstrapProjectFromCwd) {
    yield* Effect.gen(function* () {
      const snapshot = yield* projectionReadModelQuery.getSnapshot();
      const existingProject = snapshot.projects.find(
        (project) => project.workspaceRoot === cwd && project.deletedAt === null,
      );
      let bootstrapProjectId: ProjectId;
      let bootstrapProjectDefaultModelSelection;

      if (!existingProject) {
        const createdAt = new Date().toISOString();
        bootstrapProjectId = ProjectId.makeUnsafe(crypto.randomUUID());
        const bootstrapProjectTitle = path.basename(cwd) || "project";
        bootstrapProjectDefaultModelSelection = {
          provider: "codex" as const,
          model: "gpt-5-codex",
        };
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          projectId: bootstrapProjectId,
          title: bootstrapProjectTitle,
          workspaceRoot: cwd,
          defaultModelSelection: bootstrapProjectDefaultModelSelection,
          createdAt,
        });
      } else {
        bootstrapProjectId = existingProject.id;
        bootstrapProjectDefaultModelSelection = existingProject.defaultModelSelection ?? {
          provider: "codex" as const,
          model: "gpt-5-codex",
        };
      }

      const existingThread = snapshot.threads.find(
        (thread) => thread.projectId === bootstrapProjectId && thread.deletedAt === null,
      );
      if (!existingThread) {
        const createdAt = new Date().toISOString();
        const threadId = ThreadId.makeUnsafe(crypto.randomUUID());
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          threadId,
          projectId: bootstrapProjectId,
          title: "New thread",
          modelSelection: bootstrapProjectDefaultModelSelection,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          projectPath: existingProject?.workspaceRoot ?? cwd,
          branch: [null],
          worktreePath: [null],
          createdAt,
        });
        welcomeBootstrapProjectId = bootstrapProjectId;
        welcomeBootstrapThreadId = threadId;
      } else {
        welcomeBootstrapProjectId = bootstrapProjectId;
        welcomeBootstrapThreadId = existingThread.id;
      }
    }).pipe(
      Effect.mapError(
        (cause) => new ServerLifecycleError({ operation: "autoBootstrapProject", cause }),
      ),
    );
  }

  const runtimeServices = yield* Effect.services<
    ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
  >();
  const runPromise = Effect.runPromiseWith(runtimeServices);

  const unsubscribeTerminalEvents = yield* terminalManager.subscribe(
    (event) => void Effect.runPromise(pushBus.publishAll(WS_CHANNELS.terminalEvent, event)),
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => unsubscribeTerminalEvents()));
  yield* readiness.markTerminalSubscriptionsReady;

  yield* NodeHttpServer.make(() => httpServer, listenOptions).pipe(
    Effect.mapError((cause) => new ServerLifecycleError({ operation: "httpServerListen", cause })),
  );
  yield* readiness.markHttpListening;

  yield* Effect.addFinalizer(() =>
    Effect.all([closeAllClients, closeWebSocketServer.pipe(Effect.ignoreCause({ log: true }))]),
  );

  const routeRequest = Effect.fnUntraced(function* (ws: WebSocket, request: WebSocketRequest) {
    switch (request.body._tag) {
      case ORCHESTRATION_WS_METHODS.getSnapshot:
        return yield* projectionReadModelQuery.getSnapshot();

      case ORCHESTRATION_WS_METHODS.dispatchCommand: {
        const { command } = request.body;
        const normalizedCommand = yield* normalizeDispatchCommand({ command });
        return yield* orchestrationEngine.dispatch(normalizedCommand);
      }

      case ORCHESTRATION_WS_METHODS.getTurnDiff: {
        const body = stripRequestTag(request.body);
        return yield* checkpointDiffQuery.getTurnDiff(body);
      }

      case ORCHESTRATION_WS_METHODS.getFullThreadDiff: {
        const body = stripRequestTag(request.body);
        return yield* checkpointDiffQuery.getFullThreadDiff(body);
      }

      case ORCHESTRATION_WS_METHODS.replayEvents: {
        const { fromSequenceExclusive } = request.body;
        return yield* Stream.runCollect(
          orchestrationEngine.readEvents(
            clamp(fromSequenceExclusive, {
              maximum: Number.MAX_SAFE_INTEGER,
              minimum: 0,
            }),
          ),
        ).pipe(Effect.map((events) => Array.from(events)));
      }

      case WS_METHODS.projectsSearchEntries: {
        const body = stripRequestTag(request.body);
        const project = yield* resolveProject(body.projectId);
        return yield* Effect.tryPromise({
          try: () =>
            searchWorkspaceEntries({
              cwd: project.workspaceRoot,
              remote: project.remote ?? null,
              query: body.query,
              limit: body.limit,
            }),
          catch: (cause) =>
            new RouteRequestError({
              message: `Failed to search workspace entries: ${String(cause)}`,
            }),
        });
      }

      case WS_METHODS.projectsWriteFile: {
        const body = stripRequestTag(request.body);
        const workspaceRoot = yield* resolveLocalProjectWorkspaceRoot({
          projectId: body.projectId,
          operation: "Workspace file writing",
        });
        const target = yield* resolveWorkspaceRelativePath({
          workspaceRoot,
          relativePath: body.relativePath,
          path,
          label: "Workspace file path",
        });
        yield* fileSystem
          .makeDirectory(path.dirname(target.absolutePath), { recursive: true })
          .pipe(
            Effect.mapError(
              (cause) =>
                new RouteRequestError({
                  message: `Failed to prepare workspace path: ${String(cause)}`,
                }),
            ),
          );
        yield* fileSystem.writeFileString(target.absolutePath, body.contents).pipe(
          Effect.mapError(
            (cause) =>
              new RouteRequestError({
                message: `Failed to write workspace file: ${String(cause)}`,
              }),
          ),
        );
        return { relativePath: target.relativePath };
      }

      case WS_METHODS.projectsOpenInEditor: {
        const body = stripRequestTag(request.body);
        const target = yield* resolveProjectEditorTarget({
          projectId: body.projectId,
        });
        return yield* openInEditor({
          target,
          editor: body.editor,
        });
      }

      case WS_METHODS.projectsOpenPathInEditor: {
        const body = stripRequestTag(request.body);
        const target = yield* resolveProjectEditorTarget({
          projectId: body.projectId,
          ...(body.threadId ? { threadId: body.threadId } : {}),
          relativePath: body.relativePath,
          ...(body.line !== undefined ? { line: body.line } : {}),
          ...(body.column !== undefined ? { column: body.column } : {}),
        });
        return yield* openInEditor({
          target,
          editor: body.editor,
        });
      }

      case WS_METHODS.shellOpenInEditor: {
        const body = stripRequestTag(request.body);
        return yield* openInEditor(body);
      }

      case WS_METHODS.gitStatus: {
        const body = stripRequestTag(request.body);
        const { cwd, remote } = yield* resolveGitOperationTarget({
          repoPath: body.repoPath,
          ...(body.projectId ? { projectId: body.projectId } : {}),
          operation: "Git status",
        });
        return yield* gitManager.status({
          ...body,
          cwd,
          ...(remote ? { remote } : {}),
        });
      }

      case WS_METHODS.gitPull: {
        const body = stripRequestTag(request.body);
        const { cwd, remote } = yield* resolveGitOperationTarget({
          repoPath: body.repoPath,
          ...(body.projectId ? { projectId: body.projectId } : {}),
          operation: "Pull",
        });
        return yield* git.pullCurrentBranch(cwd, remote);
      }

      case WS_METHODS.gitRunStackedAction: {
        const body = stripRequestTag(request.body);
        const { cwd, remote } = yield* resolveGitOperationTarget({
          repoPath: body.repoPath,
          ...(body.projectId ? { projectId: body.projectId } : {}),
          operation: "Git action",
        });
        return yield* gitManager.runStackedAction(
          {
            ...body,
            cwd,
            ...(remote ? { remote } : {}),
          },
          {
            actionId: body.actionId,
            progressReporter: {
              publish: (event) =>
                pushBus.publishClient(ws, WS_CHANNELS.gitActionProgress, event).pipe(Effect.asVoid),
            },
          },
        );
      }

      case WS_METHODS.gitResolvePullRequest: {
        const body = stripRequestTag(request.body);
        const { cwd, remote } = yield* resolveGitOperationTarget({
          repoPath: body.repoPath,
          ...(body.projectId ? { projectId: body.projectId } : {}),
          operation: "Resolve pull request",
        });
        return yield* gitManager.resolvePullRequest({
          ...body,
          cwd,
          ...(remote ? { remote } : {}),
        });
      }

      case WS_METHODS.gitPreparePullRequestThread: {
        const body = stripRequestTag(request.body);
        const { cwd, remote } = yield* resolveGitOperationTarget({
          repoPath: body.repoPath,
          ...(body.projectId ? { projectId: body.projectId } : {}),
          operation: "Prepare pull request thread",
        });
        return yield* gitManager.preparePullRequestThread({
          ...body,
          cwd,
          ...(remote ? { remote } : {}),
        });
      }

      case WS_METHODS.gitListBranches: {
        const body = stripRequestTag(request.body);
        const { cwd, remote } = yield* resolveGitOperationTarget({
          repoPath: body.repoPath,
          ...(body.projectId ? { projectId: body.projectId } : {}),
          operation: "Listing branches",
        });
        return yield* git.listBranches({
          ...body,
          cwd,
          ...(remote ? { remote } : {}),
        });
      }

      case WS_METHODS.gitCreateWorktree: {
        const body = stripRequestTag(request.body);
        const resolvedProjectRepoPath = body.projectId
          ? yield* resolveProjectRepoRelativePath({
              projectId: body.projectId,
              repoPath: body.repoPath,
            })
          : null;
        yield* ensureSyntheticParentExtras({
          ...(body.projectId ? { projectId: body.projectId } : {}),
          ...(resolvedProjectRepoPath ? { repoPath: resolvedProjectRepoPath } : {}),
          requestedWorktreePath: body.path ?? null,
        });
        const { cwd, remote } = yield* resolveGitOperationTarget({
          repoPath: body.repoPath,
          ...(body.projectId ? { projectId: body.projectId } : {}),
          operation: "Creating a worktree",
        });
        return yield* git.createWorktree({
          ...body,
          cwd,
          ...(remote ? { remote } : {}),
        });
      }

      case WS_METHODS.gitRemoveWorktree: {
        const body = stripRequestTag(request.body);
        const { cwd, remote } = yield* resolveGitOperationTarget({
          repoPath: body.repoPath,
          ...(body.projectId ? { projectId: body.projectId } : {}),
          operation: "Removing a worktree",
        });
        return yield* git.removeWorktree({
          ...body,
          cwd,
          ...(remote ? { remote } : {}),
        });
      }

      case WS_METHODS.gitCreateBranch: {
        const body = stripRequestTag(request.body);
        const { cwd, remote } = yield* resolveGitOperationTarget({
          repoPath: body.repoPath,
          ...(body.projectId ? { projectId: body.projectId } : {}),
          operation: "Creating a branch",
        });
        return yield* git.createBranch({
          ...body,
          cwd,
          ...(remote ? { remote } : {}),
        });
      }

      case WS_METHODS.gitCheckout: {
        const body = stripRequestTag(request.body);
        const { cwd, remote } = yield* resolveGitOperationTarget({
          repoPath: body.repoPath,
          ...(body.projectId ? { projectId: body.projectId } : {}),
          operation: "Checking out a branch",
        });
        return yield* Effect.scoped(
          git.checkoutBranch({
            ...body,
            cwd,
            ...(remote ? { remote } : {}),
          }),
        );
      }

      case WS_METHODS.gitInit: {
        const body = stripRequestTag(request.body);
        const project = body.projectId ? yield* resolveProject(body.projectId) : null;
        if (project?.gitMode === "multi") {
          return yield* new RouteRequestError({
            message: "Git init is unavailable for multi-repo projects.",
          });
        }
        const { cwd, remote } = yield* resolveGitOperationTarget({
          repoPath: body.repoPath,
          ...(body.projectId ? { projectId: body.projectId } : {}),
          operation: "Git init",
        });
        return yield* git.initRepo({
          ...body,
          cwd,
          ...(remote ? { remote } : {}),
        });
      }

      case WS_METHODS.terminalOpen: {
        const body = stripRequestTag(request.body);
        const remote = yield* resolveProjectRemote(body.projectId);
        return yield* terminalManager.open({
          ...body,
          ...(remote ? { remote } : {}),
        });
      }

      case WS_METHODS.terminalWrite: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.write(body);
      }

      case WS_METHODS.terminalResize: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.resize(body);
      }

      case WS_METHODS.terminalClear: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.clear(body);
      }

      case WS_METHODS.terminalRestart: {
        const body = stripRequestTag(request.body);
        const remote = yield* resolveProjectRemote(body.projectId);
        return yield* terminalManager.restart({
          ...body,
          ...(remote ? { remote } : {}),
        });
      }

      case WS_METHODS.terminalClose: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.close(body);
      }

      case WS_METHODS.serverGetConfig:
        const keybindingsConfig = yield* keybindingsManager.loadConfigState;
        return {
          cwd,
          keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers: providerStatuses,
          availableEditors,
        };

      case WS_METHODS.serverListSshHosts:
        return yield* Effect.tryPromise({
          try: async () => ({ hosts: await listSshHosts() }),
          catch: (cause) =>
            new RouteRequestError({
              message: `Failed to list SSH hosts: ${String(cause)}`,
            }),
        });

      case WS_METHODS.serverValidateRemoteProject: {
        const body = stripRequestTag(request.body);
        return yield* Effect.tryPromise({
          try: () =>
            validateRemoteProjectOverSsh(body, {
              localCwd: cwd,
            }),
          catch: (cause) =>
            new RouteRequestError({
              message:
                cause instanceof Error ? cause.message : "Failed to validate the remote project.",
            }),
        });
      }

      case WS_METHODS.serverUpsertKeybinding: {
        const body = stripRequestTag(request.body);
        const keybindingsConfig = yield* keybindingsManager.upsertKeybindingRule(body);
        return { keybindings: keybindingsConfig, issues: [] };
      }

      default: {
        const _exhaustiveCheck: never = request.body;
        return yield* new RouteRequestError({
          message: `Unknown method: ${String(_exhaustiveCheck)}`,
        });
      }
    }
  });

  const handleMessage = Effect.fnUntraced(function* (ws: WebSocket, raw: unknown) {
    const sendWsResponse = (response: WsResponseMessage) =>
      encodeWsResponse(response).pipe(
        Effect.tap((encodedResponse) => Effect.sync(() => ws.send(encodedResponse))),
        Effect.asVoid,
      );

    const messageText = websocketRawToString(raw);
    if (messageText === null) {
      return yield* sendWsResponse({
        id: "unknown",
        error: { message: "Invalid request format: Failed to read message" },
      });
    }

    const request = decodeWebSocketRequest(messageText);
    if (Result.isFailure(request)) {
      return yield* sendWsResponse({
        id: "unknown",
        error: { message: `Invalid request format: ${formatSchemaError(request.failure)}` },
      });
    }

    const result = yield* Effect.exit(routeRequest(ws, request.success));
    if (Exit.isFailure(result)) {
      return yield* sendWsResponse({
        id: request.success.id,
        error: { message: formatRouteFailureMessage(result.cause) },
      });
    }

    return yield* sendWsResponse({
      id: request.success.id,
      result: result.value,
    });
  });

  httpServer.on("upgrade", (request, socket, head) => {
    socket.on("error", () => {}); // Prevent unhandled `EPIPE`/`ECONNRESET` from crashing the process if the client disconnects mid-handshake

    if (authToken) {
      let providedToken: string | null = null;
      try {
        const url = new URL(request.url ?? "/", `http://localhost:${port}`);
        providedToken = url.searchParams.get("token");
      } catch {
        rejectUpgrade(socket, 400, "Invalid WebSocket URL");
        return;
      }

      if (providedToken !== authToken) {
        rejectUpgrade(socket, 401, "Unauthorized WebSocket connection");
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws) => {
    const segments = cwd.split(/[/\\]/).filter(Boolean);
    const projectName = segments[segments.length - 1] ?? "project";

    const welcomeData = {
      cwd,
      projectName,
      ...(welcomeBootstrapProjectId ? { bootstrapProjectId: welcomeBootstrapProjectId } : {}),
      ...(welcomeBootstrapThreadId ? { bootstrapThreadId: welcomeBootstrapThreadId } : {}),
    };
    // Send welcome before adding to broadcast set so publishAll calls
    // cannot reach this client before the welcome arrives.
    void runPromise(
      readiness.awaitServerReady.pipe(
        Effect.flatMap(() => pushBus.publishClient(ws, WS_CHANNELS.serverWelcome, welcomeData)),
        Effect.flatMap((delivered) =>
          delivered ? Ref.update(clients, (clients) => clients.add(ws)) : Effect.void,
        ),
      ),
    );

    ws.on("message", (raw) => {
      void runPromise(handleMessage(ws, raw).pipe(Effect.ignoreCause({ log: true })));
    });

    ws.on("close", () => {
      void runPromise(
        Ref.update(clients, (clients) => {
          clients.delete(ws);
          return clients;
        }),
      );
    });

    ws.on("error", () => {
      void runPromise(
        Ref.update(clients, (clients) => {
          clients.delete(ws);
          return clients;
        }),
      );
    });
  });

  return httpServer;
});

export const ServerLive = Layer.succeed(Server, {
  start: createServer(),
  stopSignal: Effect.never,
} satisfies ServerShape);
