import {
  BotIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleEllipsisIcon,
  FileCode2Icon,
  SearchIcon,
  TerminalSquareIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

import type { ThreadDetail, TimelineItem } from "../../appServer/presentation";

function ToolIcon({ type }: { readonly type: string }) {
  if (type === "commandExecution") return <TerminalSquareIcon className="size-4" />;
  if (type === "fileChange") return <FileCode2Icon className="size-4" />;
  if (type === "webSearch") return <SearchIcon className="size-4" />;
  return <WrenchIcon className="size-4" />;
}

function TimelineEntry({ item }: { readonly item: TimelineItem }) {
  if (item.type === "userMessage") {
    return (
      <article className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-3 text-[15px] leading-6">
        <p className="whitespace-pre-wrap">{item.text}</p>
      </article>
    );
  }
  if (item.type === "agentMessage" || item.type === "plan") {
    return (
      <article className="flex gap-3 text-[15px] leading-7">
        <div className="mt-1 grid size-6 shrink-0 place-items-center text-muted-foreground">
          <BotIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1 whitespace-pre-wrap">{item.text || "…"}</div>
      </article>
    );
  }
  if (item.type === "reasoning") {
    return (
      <details className="group text-sm text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center gap-2 py-1">
          <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />
          <CircleEllipsisIcon className="size-4" />
          <span>{item.title}</span>
        </summary>
        {item.text ? (
          <p className="ml-9 mt-1 whitespace-pre-wrap text-xs leading-5">{item.text}</p>
        ) : null}
      </details>
    );
  }
  return (
    <details className="group rounded-lg border border-border/70 bg-card/40 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
        <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
        <ToolIcon type={item.type} />
        <span className="min-w-0 flex-1 truncate font-medium">{item.title ?? item.type}</span>
        {item.status === "completed" ? (
          <CheckCircle2Icon className="size-3.5 text-emerald-500" />
        ) : null}
        {item.status ? (
          <span className="text-[11px] text-muted-foreground">{item.status}</span>
        ) : null}
      </summary>
      {item.detail || item.text ? (
        <div className="border-t border-border/70 px-4 py-3 font-mono text-xs leading-5 text-muted-foreground">
          {item.detail ? <p className="mb-2 [overflow-wrap:anywhere]">{item.detail}</p> : null}
          {item.text ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap">{item.text}</pre>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

export function ThreadTimeline({ thread }: { readonly thread: ThreadDetail }) {
  const end = useRef<HTMLDivElement>(null);
  const itemCount = thread.turns.reduce((count, turn) => count + turn.items.length, 0);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [itemCount]);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-7 px-8 pb-8 pt-10">
      {thread.turns.flatMap((turn) =>
        turn.items.map((item) => <TimelineEntry item={item} key={`${turn.id}:${item.id}`} />),
      )}
      {thread.turns.some((turn) => turn.status === "inProgress") ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <BotIcon className="size-4" />
          <span>Working…</span>
        </div>
      ) : null}
      <div ref={end} />
    </div>
  );
}
