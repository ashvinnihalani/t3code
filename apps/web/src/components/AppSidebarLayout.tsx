import type { ReactNode } from "react";

export function AppSidebarLayout({
  sidebar,
  children,
}: {
  readonly sidebar: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <main className="flex h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      {sidebar}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {children}
      </section>
    </main>
  );
}
