import { describe, expect, it } from "@effect/vitest";

import type { TraceEntry } from "../protocol/MessageRecorder.ts";
import { validateTraceSchemas } from "./SchemaValidator.ts";

describe("validateTraceSchemas", () => {
  it("accepts messages conforming to the generated method tables", () => {
    const trace: ReadonlyArray<TraceEntry> = [
      {
        sequence: 1,
        direction: "client-to-server",
        kind: "request",
        method: "initialize",
        id: 1,
        payload: {
          id: 1,
          method: "initialize",
          params: {
            clientInfo: { name: "conformance", title: "Conformance", version: "0.0.0" },
            capabilities: null,
          },
        },
      },
      {
        sequence: 2,
        direction: "server-to-client",
        kind: "response",
        id: 1,
        payload: {
          id: 1,
          result: {
            codexHome: "/tmp/codex",
            platformFamily: "unix",
            platformOs: "macos",
            userAgent: "reference",
          },
        },
      },
      {
        sequence: 3,
        direction: "client-to-server",
        kind: "notification",
        method: "initialized",
        payload: { method: "initialized" },
      },
      {
        sequence: 4,
        direction: "server-to-client",
        kind: "notification",
        method: "skills/changed",
        payload: { method: "skills/changed", params: {} },
      },
    ];

    expect(validateTraceSchemas(trace)).toEqual([]);
  });

  it("reports unknown methods, invalid payloads, and uncorrelated responses", () => {
    const trace: ReadonlyArray<TraceEntry> = [
      {
        sequence: 1,
        direction: "client-to-server",
        kind: "request",
        method: "initialize",
        id: 1,
        payload: { id: 1, method: "initialize", params: {} },
      },
      {
        sequence: 2,
        direction: "server-to-client",
        kind: "notification",
        method: "t3/custom",
        payload: { method: "t3/custom", params: {} },
      },
      {
        sequence: 3,
        direction: "server-to-client",
        kind: "response",
        id: 99,
        payload: { id: 99, result: {} },
      },
      {
        sequence: 4,
        direction: "server-to-client",
        kind: "notification",
        method: "item/agentMessage/delta",
        payload: { method: "item/agentMessage/delta", params: {} },
      },
    ];

    const issues = validateTraceSchemas(trace);
    expect(issues).toHaveLength(4);
    expect(issues.map((entry) => entry.detail)).toEqual([
      expect.stringContaining("initialize payload failed schema validation"),
      "Unknown server-to-client notification method: t3/custom.",
      "Response 99 has no matching request.",
      expect.stringContaining("item/agentMessage/delta payload failed schema validation"),
    ]);
  });

  it("validates a correlated response against its request method", () => {
    const trace: ReadonlyArray<TraceEntry> = [
      {
        sequence: 1,
        direction: "client-to-server",
        kind: "request",
        method: "initialize",
        id: 7,
        payload: {
          id: 7,
          method: "initialize",
          params: {
            clientInfo: { name: "conformance", title: "Conformance", version: "0.0.0" },
          },
        },
      },
      {
        sequence: 2,
        direction: "server-to-client",
        kind: "response",
        id: 7,
        payload: { id: 7, result: { userAgent: "missing required platform fields" } },
      },
    ];

    expect(validateTraceSchemas(trace)).toEqual([
      expect.objectContaining({
        sequence: 2,
        detail: expect.stringContaining("initialize payload failed schema validation"),
      }),
    ]);
  });
});
