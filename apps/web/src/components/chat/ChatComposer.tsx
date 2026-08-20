import { ArrowUpIcon, BotIcon, ChevronDownIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { ModelOption } from "../../appServer/presentation";

export function ChatComposer({
  models,
  disabled,
  running,
  placeholder,
  onSend,
  onInterrupt,
}: {
  readonly models: ReadonlyArray<ModelOption>;
  readonly disabled: boolean;
  readonly running: boolean;
  readonly placeholder: string;
  readonly onSend: (prompt: string, model: string | null) => Promise<void> | void;
  readonly onInterrupt: () => Promise<void> | void;
}) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const selectedModel =
    models.find((candidate) => candidate.model === model) ??
    models.find((candidate) => candidate.isDefault) ??
    models[0] ??
    null;

  useEffect(() => {
    if (model === null && selectedModel !== null) setModel(selectedModel.model);
  }, [model, selectedModel]);

  const submit = async () => {
    const value = prompt.trim();
    if (!value || disabled) return;
    setPrompt("");
    await onSend(value, selectedModel?.model ?? null);
    textarea.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  return (
    <div className="w-full rounded-[22px] border border-input bg-card p-3 shadow-[0_10px_40px_rgba(0,0,0,0.08)] dark:shadow-[0_12px_48px_rgba(0,0,0,0.28)]">
      <textarea
        ref={textarea}
        data-composer-input=""
        aria-label="Message"
        className="block min-h-20 max-h-52 w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
        disabled={disabled}
        placeholder={placeholder}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="mt-2 flex items-center gap-2">
        <label className="relative inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
          <BotIcon className="size-4" />
          <span>{selectedModel?.displayName ?? "Codex"}</span>
          <ChevronDownIcon className="size-3.5" />
          <select
            aria-label="Model"
            className="absolute inset-0 cursor-pointer opacity-0"
            disabled={models.length === 0}
            value={selectedModel?.model ?? ""}
            onChange={(event) => setModel(event.target.value)}
          >
            {models.map((candidate) => (
              <option key={candidate.id} value={candidate.model}>
                {candidate.displayName}
              </option>
            ))}
          </select>
        </label>
        <span className="flex-1" />
        {running ? (
          <button
            aria-label="Stop"
            className="grid size-8 place-items-center rounded-full bg-foreground text-background hover:opacity-85"
            onClick={() => void onInterrupt()}
          >
            <SquareIcon className="size-3 fill-current" />
          </button>
        ) : (
          <button
            aria-label="Send"
            className="grid size-8 place-items-center rounded-full bg-foreground text-background hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-25"
            disabled={disabled || prompt.trim().length === 0}
            onClick={() => void submit()}
          >
            <ArrowUpIcon className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
