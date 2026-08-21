# Development and releases

Use mise for the pinned project toolchain:

```bash
mise install
mise exec node@24.13.1 pnpm@11.10.0 -- pnpm install
```

Useful focused commands:

```bash
mise exec node@24.13.1 pnpm@11.10.0 -- pnpm --filter @t3tools/web typecheck
mise exec node@24.13.1 pnpm@11.10.0 -- pnpm --filter @t3tools/desktop typecheck
mise exec node@24.13.1 pnpm@11.10.0 -- pnpm --filter effect-codex-app-server test
mise exec node@24.13.1 pnpm@11.10.0 -- pnpm build:desktop
```

Build an unsigned Apple Silicon image with:

```bash
mise exec node@24.13.1 pnpm@11.10.0 -- pnpm dist:desktop:dmg:arm64
```

The release builder stages only the Electron bundle, web renderer, and retained runtime dependencies. It must never stage `apps/server` or require a bundled T3 backend.

Keep feature commits conventional and focused. When adapting UI, prefer the upstream component and remove irrelevant controls in place; protocol-specific behavior belongs at the app-server adapter boundary.
