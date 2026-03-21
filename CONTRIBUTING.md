# Contributing

## Read This First

This is a personal fork maintained by one person.

Issues and PRs are mainly here as a personal tracking and change-management workflow, not as an open contribution process.

This project is still early. Scope is intentionally tight so the fork stays reliable and maintainable.

PRs are automatically labeled with a `vouch:*` trust status and a `size:*` diff size based on changed lines.

## What I Am Most Likely To Keep

- Small, focused bug fixes.
- Small reliability fixes.
- Small performance improvements.
- Tightly scoped maintenance work that clearly improves the project without changing its direction.
- Documentation improvements that remove ambiguity for users or contributors.

## What I Am Least Likely To Keep

- Large PRs.
- Opinionated rewrites.
- Anything that expands product scope or long-term maintenance burden without a strong justification.
- PRs that add dependencies, settings, or workflow complexity without a clear operational benefit.

## If You Still Want To Open A PR

Keep it small.

Explain exactly what changed.

Explain exactly why the change should exist.

Explain what maintenance cost it adds, if any.

Do not mix unrelated fixes together.

If the PR makes anything resembling a UI change, include clear before/after images.

If the change depends on motion, timing, transitions, or interaction details, include a short video.

Run `bun fmt`, `bun lint`, and `bun typecheck` before opening the PR.

If I have to guess what changed, why it matters, or whether it is safe to maintain, the template is not doing its job.

## Issues First

If you are thinking about a non-trivial change, open an issue first.

That gives the change a written problem statement before code lands.

## Be Realistic

Opening a PR in this fork is mostly a way to leave reviewable history for future-you.
