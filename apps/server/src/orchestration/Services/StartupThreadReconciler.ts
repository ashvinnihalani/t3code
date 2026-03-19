import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface StartupThreadReconcilerShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
}

export class StartupThreadReconciler extends ServiceMap.Service<
  StartupThreadReconciler,
  StartupThreadReconcilerShape
>()("t3/orchestration/Services/StartupThreadReconciler") {}
