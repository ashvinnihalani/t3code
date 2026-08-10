import * as Predicate from "effect/Predicate";

import type { TraceEntry } from "../protocol/MessageRecorder.ts";

export interface TraceNormalizerOptions {
  readonly workspace: string;
  readonly codexHome: string;
}

type IdentityKind = "thread" | "turn" | "item" | "request" | "time";

const identityKeyKinds: Readonly<Record<string, IdentityKind>> = {
  threadid: "thread",
  conversationid: "thread",
  turnid: "turn",
  itemid: "item",
  requestid: "request",
  timestamp: "time",
  createdat: "time",
  updatedat: "time",
};

const canonicalKey = (key: string): string => key.replaceAll("_", "").toLowerCase();

const replaceAllLiteral = (value: string, search: string, replacement: string): string =>
  search.length === 0 ? value : value.split(search).join(replacement);

export class TraceNormalizer {
  readonly #identities: Record<IdentityKind, Map<string, string>> = {
    thread: new Map(),
    turn: new Map(),
    item: new Map(),
    request: new Map(),
    time: new Map(),
  };
  readonly options: TraceNormalizerOptions;

  constructor(options: TraceNormalizerOptions) {
    this.options = options;
  }

  normalize(trace: ReadonlyArray<TraceEntry>): ReadonlyArray<TraceEntry> {
    return trace.map((entry) => {
      const payload = this.#normalizeValue(entry.payload);
      const normalizedId =
        entry.id === undefined ? undefined : this.#normalizeIdentity("request", entry.id);
      return {
        ...entry,
        ...(normalizedId === undefined ? {} : { id: normalizedId }),
        payload,
      };
    });
  }

  #normalizeValue(value: unknown, key?: string, depth = 0): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.#normalizeValue(item, key, depth));
    }

    if (Predicate.isObject(value)) {
      const normalized: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        normalized[childKey] = this.#normalizeValue(childValue, childKey, depth + 1);
      }
      return normalized;
    }

    const normalizedKey = key === undefined ? undefined : canonicalKey(key);
    const identityKind: IdentityKind | undefined =
      normalizedKey === "id" && depth === 1
        ? "request"
        : normalizedKey === undefined
          ? undefined
          : identityKeyKinds[normalizedKey];
    if (identityKind !== undefined && (typeof value === "string" || typeof value === "number")) {
      return this.#normalizeIdentity(identityKind, value);
    }

    if (normalizedKey === "version" || normalizedKey === "appversion") {
      return "$VERSION";
    }
    if (normalizedKey === "installationid") {
      return "$INSTALLATION";
    }
    if (typeof value === "string") {
      return replaceAllLiteral(
        replaceAllLiteral(value, this.options.workspace, "$WORKSPACE"),
        this.options.codexHome,
        "$CODEX_HOME",
      );
    }
    return value;
  }

  #normalizeIdentity(kind: IdentityKind, value: string | number): string {
    const raw = String(value);
    const identities = this.#identities[kind];
    const existing = identities.get(raw);
    if (existing !== undefined) return existing;
    const normalized = `$${kind}${identities.size + 1}`;
    identities.set(raw, normalized);
    return normalized;
  }
}

export const normalizeTrace = (
  trace: ReadonlyArray<TraceEntry>,
  options: TraceNormalizerOptions,
): ReadonlyArray<TraceEntry> => new TraceNormalizer(options).normalize(trace);
