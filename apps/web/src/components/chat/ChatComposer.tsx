import {
  ArrowUpIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  MoreHorizontalIcon,
  SearchIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { ComposerAccessMode, ComposerOptions } from "../../appServer/composerOptions";
import type { ModelOption } from "../../appServer/presentation";

const ACCESS_OPTIONS: ReadonlyArray<{
  readonly id: ComposerAccessMode;
  readonly label: string;
}> = [
  { id: "supervised", label: "Supervised" },
  { id: "auto-accept-edits", label: "Auto-accept edits" },
  { id: "auto", label: "Auto" },
  { id: "full-access", label: "Full access" },
];

function effortLabel(value: string): string {
  if (value === "xhigh") return "Extra High";
  return value.replaceAll("-", " ").replace(/^./u, (character) => character.toUpperCase());
}

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
  readonly onSend: (prompt: string, options: ComposerOptions) => Promise<void> | void;
  readonly onInterrupt: () => Promise<void> | void;
}) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [serviceTier, setServiceTier] = useState<string | null>(null);
  const [access, setAccess] = useState<ComposerAccessMode>("auto");
  const [modelOpen, setModelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const selectedModel =
    models.find((candidate) => candidate.model === model) ??
    models.find((candidate) => candidate.isDefault) ??
    models[0] ??
    null;

  useEffect(() => {
    if (selectedModel === null) return;
    if (model !== selectedModel.model) setModel(selectedModel.model);
    if (
      effort === null ||
      !selectedModel.supportedReasoningEfforts.some(
        (candidate) => candidate.reasoningEffort === effort,
      )
    ) {
      setEffort(selectedModel.defaultReasoningEffort);
    }
    if (
      serviceTier === null ||
      !selectedModel.serviceTiers.some((candidate) => candidate.id === serviceTier)
    ) {
      setServiceTier(selectedModel.defaultServiceTier ?? selectedModel.serviceTiers[0]?.id ?? null);
    }
  }, [effort, model, selectedModel, serviceTier]);

  useEffect(() => {
    if (!modelOpen && !settingsOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (event.target instanceof Node && !controls.current?.contains(event.target)) {
        setModelOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener("mousedown", dismiss);
    return () => window.removeEventListener("mousedown", dismiss);
  }, [modelOpen, settingsOpen]);

  const visibleModels = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase();
    return query
      ? models.filter((candidate) =>
          `${candidate.displayName} ${candidate.model} ${candidate.description}`
            .toLocaleLowerCase()
            .includes(query),
        )
      : models;
  }, [modelQuery, models]);

  const selectModel = (next: ModelOption) => {
    setModel(next.model);
    setEffort(next.defaultReasoningEffort);
    setServiceTier(next.defaultServiceTier ?? next.serviceTiers[0]?.id ?? null);
    setModelOpen(false);
  };

  const submit = async () => {
    const value = prompt.trim();
    if (!value || disabled) return;
    setPrompt("");
    await onSend(value, {
      model: selectedModel?.model ?? null,
      effort,
      serviceTier,
      access,
    });
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
      <div ref={controls} className="relative mt-2 flex items-center gap-1">
        <button
          aria-expanded={modelOpen}
          aria-haspopup="listbox"
          className="inline-flex h-7 min-w-0 max-w-56 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          disabled={models.length === 0}
          type="button"
          onClick={() => {
            setSettingsOpen(false);
            setModelOpen((open) => !open);
          }}
        >
          <BotIcon className="size-4 shrink-0" />
          <span className="truncate">{selectedModel?.displayName ?? "Codex"}</span>
          <ChevronDownIcon className="size-3.5 shrink-0" />
        </button>
        <button
          aria-label="Model and access settings"
          aria-expanded={settingsOpen}
          aria-haspopup="menu"
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          type="button"
          onClick={() => {
            setModelOpen(false);
            setSettingsOpen((open) => !open);
          }}
        >
          <MoreHorizontalIcon className="size-4" />
        </button>

        {modelOpen ? (
          <div className="absolute bottom-full left-0 z-50 mb-2 w-80 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl">
            <label className="flex h-10 items-center gap-2 border-b border-border px-3 text-muted-foreground">
              <SearchIcon className="size-4" />
              <input
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="Search models"
                value={modelQuery}
                onChange={(event) => setModelQuery(event.target.value)}
              />
            </label>
            <div className="max-h-72 overflow-y-auto p-1.5" role="listbox" aria-label="Model">
              {visibleModels.map((candidate) => {
                const active = candidate.model === selectedModel?.model;
                return (
                  <button
                    aria-selected={active}
                    className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left ${active ? "bg-accent" : "hover:bg-accent/60"}`}
                    key={candidate.id}
                    role="option"
                    type="button"
                    onClick={() => selectModel(candidate)}
                  >
                    <BotIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{candidate.displayName}</span>
                      {candidate.description ? (
                        <span className="mt-0.5 block line-clamp-2 text-xs leading-4 text-muted-foreground">
                          {candidate.description}
                        </span>
                      ) : null}
                    </span>
                    {active ? <CheckIcon className="mt-0.5 size-4 shrink-0" /> : null}
                  </button>
                );
              })}
              {visibleModels.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No matching models.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {settingsOpen && selectedModel ? (
          <div className="absolute bottom-full left-20 z-50 mb-2 w-64 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl">
            <MenuSection title="Reasoning">
              {selectedModel.supportedReasoningEfforts.map((option) => (
                <MenuOption
                  active={option.reasoningEffort === effort}
                  defaultOption={option.reasoningEffort === selectedModel.defaultReasoningEffort}
                  key={option.reasoningEffort}
                  label={effortLabel(option.reasoningEffort)}
                  onClick={() => setEffort(option.reasoningEffort)}
                />
              ))}
            </MenuSection>
            {selectedModel.serviceTiers.length > 0 ? (
              <MenuSection title="Service Tier">
                {selectedModel.serviceTiers.map((tier) => (
                  <MenuOption
                    active={tier.id === serviceTier}
                    defaultOption={tier.id === selectedModel.defaultServiceTier}
                    key={tier.id}
                    label={tier.name}
                    onClick={() => setServiceTier(tier.id)}
                  />
                ))}
              </MenuSection>
            ) : null}
            <MenuSection title="Access" last>
              {ACCESS_OPTIONS.map((option) => (
                <MenuOption
                  active={option.id === access}
                  defaultOption={option.id === "auto"}
                  key={option.id}
                  label={option.label}
                  onClick={() => setAccess(option.id)}
                />
              ))}
            </MenuSection>
          </div>
        ) : null}

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

function MenuSection({
  title,
  last = false,
  children,
}: {
  readonly title: string;
  readonly last?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section className={last ? "p-1" : "border-b border-border p-1 pb-1.5"}>
      <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function MenuOption({
  label,
  active,
  defaultOption,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly defaultOption: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      className={`flex h-8 w-full items-center rounded-md px-2 text-left text-sm ${active ? "bg-accent text-foreground" : "hover:bg-accent/60"}`}
      type="button"
      onClick={onClick}
    >
      <span className="flex-1">{label}</span>
      {defaultOption ? (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          Default
        </span>
      ) : null}
      {active ? <CheckIcon className="ml-1.5 size-3.5" /> : null}
    </button>
  );
}
