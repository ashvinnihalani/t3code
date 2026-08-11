# Contributing

T3 Codex is an early desktop extraction. Keep changes small and preserve the app-server ownership
boundary described in [AGENTS.md](./AGENTS.md).

Before submitting a change:

1. Install with `vp i`.
2. Run focused tests and typechecks for the packages you changed.
3. Run `vp run build:desktop` for desktop or renderer changes.
4. Update user or internal docs when behavior or architecture changes.
5. Use a conventional commit title.

UI changes should include before/after images. Protocol changes must update the pinned generated
client and conformance expectations together. Harness-specific behavior belongs behind app-server,
not in this repository's desktop client.
