import type { ReactNode } from "react";

export function SettingsPageContainer({ children }: { readonly children: ReactNode }) {
  return (
    <div className="settings-page-scroll-fade min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-12">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-12">{children}</div>
    </div>
  );
}

export function SettingsSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-8 items-center justify-between gap-4 px-4">
        <h2 className="text-lg font-semibold tracking-[-0.025em] text-foreground">{title}</h2>
      </div>
      <div className="relative space-y-1 overflow-visible text-foreground">{children}</div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  status,
  control,
}: {
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly status?: ReactNode;
  readonly control?: ReactNode;
}) {
  return (
    <div className="rounded-xl px-4 py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(10rem,auto)] items-center gap-8">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-medium tracking-[-0.005em] text-foreground">{title}</h3>
          <p className="max-w-xl text-[13px] leading-[1.45] text-muted-foreground/80">
            {description}
          </p>
          {status ? <div className="pt-0.5 text-xs text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div className="flex shrink-0 items-center justify-end gap-2">{control}</div>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsSelect({
  label,
  value,
  children,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly children: ReactNode;
  readonly onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      className="h-9 min-w-40 rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

export function SettingsSwitch({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`relative h-6 w-10 rounded-full border transition-colors ${checked ? "border-primary bg-primary" : "border-input bg-muted"}`}
      role="switch"
      type="button"
      onClick={() => onChange(!checked)}
    >
      <span
        className={`absolute top-0.5 size-4.5 rounded-full bg-white shadow-sm transition-transform ${checked ? "left-[18px]" : "left-0.5"}`}
      />
    </button>
  );
}
