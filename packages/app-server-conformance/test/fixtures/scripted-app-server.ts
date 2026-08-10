const runtime = process;
const workspace = runtime.cwd();
const threadId = "thread-fixture-7d1";
const sessionId = "session-fixture-42";
const turnId = "turn-fixture-9a2";
const itemId = "item-fixture-3c4";
const createdAt = 1_700_000_000;
const startedAt = 1_700_000_001;
const completedAt = 1_700_000_002;

const write = (message: unknown) => runtime.stdout.write(`${JSON.stringify(message)}\n`);
const respond = (id: string | number, result: unknown) => write({ id, result });

const thread = () => ({
  cliVersion: "fixture-0.0.1",
  createdAt,
  cwd: workspace,
  ephemeral: false,
  id: threadId,
  modelProvider: "fixture-provider",
  preview: "",
  sessionId,
  source: "appServer",
  status: { type: "idle" },
  turns: [],
  updatedAt: createdAt,
});

const handle = (message: Record<string, unknown>) => {
  switch (message.method) {
    case "initialize":
      respond(message.id as string | number, {
        codexHome: workspace,
        platformFamily: "fixture",
        platformOs: "fixture",
        userAgent: "scripted-app-server/0.0.1",
      });
      return;
    case "initialized":
      return;
    case "thread/start":
      respond(message.id as string | number, {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        cwd: workspace,
        model: "fixture-model",
        modelProvider: "fixture-provider",
        sandbox: { type: "dangerFullAccess" },
        thread: thread(),
      });
      write({ method: "thread/started", params: { thread: thread() } });
      return;
    case "turn/start": {
      const inProgressTurn = {
        id: turnId,
        items: [],
        startedAt,
        status: "inProgress",
      };
      const completedItem = { id: itemId, text: "Hello from the fixture.", type: "agentMessage" };
      respond(message.id as string | number, { turn: inProgressTurn });
      write({ method: "turn/started", params: { threadId, turn: inProgressTurn } });
      write({
        method: "item/started",
        params: {
          item: { id: itemId, text: "", type: "agentMessage" },
          startedAtMs: startedAt * 1_000,
          threadId,
          turnId,
        },
      });
      write({
        method: "item/agentMessage/delta",
        params: { delta: "Hello ", itemId, threadId, turnId },
      });
      write({
        method: "item/agentMessage/delta",
        params: { delta: "from the fixture.", itemId, threadId, turnId },
      });
      write({
        method: "item/completed",
        params: {
          completedAtMs: completedAt * 1_000,
          item: completedItem,
          threadId,
          turnId,
        },
      });
      write({
        method: "turn/completed",
        params: {
          threadId,
          turn: {
            completedAt,
            id: turnId,
            items: [completedItem],
            startedAt,
            status: "completed",
          },
        },
      });
      return;
    }
    default:
      if (message.id !== undefined) {
        write({ id: message.id, error: { code: -32_601, message: "Method not found" } });
      }
  }
};

let remainder = "";
runtime.stdin.setEncoding("utf8");
runtime.stdin.on("data", (chunk: string) => {
  remainder += chunk;
  const lines = remainder.split("\n");
  remainder = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    handle(JSON.parse(line) as Record<string, unknown>);
  }
});
runtime.stdin.on("end", () => runtime.exit(0));
