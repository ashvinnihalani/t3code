import { fromLenientJson } from "@t3tools/shared/schemaJson";
import {
  AppServerDesktopSettings,
  type AppServerDesktopSettings as AppServerDesktopSettingsType,
} from "effect-codex-app-server/connection";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { parseAppServerDesktopSettings } from "./configuration.ts";

export class AppServerSettingsStoreError extends Schema.TaggedErrorClass<AppServerSettingsStoreError>()(
  "AppServerSettingsStoreError",
  {
    operation: Schema.Literals(["read", "decode", "encode", "write"]),
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `App-server settings ${this.operation} failed at ${this.path}.`;
  }
}

export interface AppServerSettingsStore {
  readonly read: Effect.Effect<AppServerDesktopSettingsType, AppServerSettingsStoreError>;
  readonly write: (
    value: unknown,
  ) => Effect.Effect<AppServerDesktopSettingsType, AppServerSettingsStoreError>;
}

const AppServerDesktopSettingsJson = fromLenientJson(AppServerDesktopSettings);
const decodeSettingsJson = Schema.decodeEffect(AppServerDesktopSettingsJson);
const encodeSettingsJson = Schema.encodeEffect(AppServerDesktopSettingsJson);
const isAppServerSettingsStoreError = Schema.is(AppServerSettingsStoreError);

export function makeAppServerSettingsStore(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly settingsPath: string;
  readonly defaults: AppServerDesktopSettingsType;
}): AppServerSettingsStore {
  const decodeSettings = (raw: string) =>
    decodeSettingsJson(raw).pipe(
      Effect.flatMap((settings) =>
        Effect.try({
          try: () => parseAppServerDesktopSettings(settings),
          catch: (cause) =>
            new AppServerSettingsStoreError({
              operation: "decode",
              path: input.settingsPath,
              cause,
            }),
        }),
      ),
      Effect.mapError((cause) =>
        isAppServerSettingsStoreError(cause)
          ? cause
          : new AppServerSettingsStoreError({
              operation: "decode",
              path: input.settingsPath,
              cause,
            }),
      ),
    );

  const read = input.fileSystem.readFileString(input.settingsPath).pipe(
    Effect.catch((error) =>
      error.reason._tag === "NotFound"
        ? Effect.succeed<string | null>(null)
        : Effect.fail(
            new AppServerSettingsStoreError({
              operation: "read",
              path: input.settingsPath,
              cause: error,
            }),
          ),
    ),
    Effect.flatMap((raw) => (raw === null ? Effect.succeed(input.defaults) : decodeSettings(raw))),
  );

  const write = (value: unknown) =>
    Effect.gen(function* () {
      const settings = yield* Effect.try({
        try: () => parseAppServerDesktopSettings(value),
        catch: (cause) =>
          new AppServerSettingsStoreError({
            operation: "decode",
            path: input.settingsPath,
            cause,
          }),
      });
      const directory = input.path.dirname(input.settingsPath);
      const temporaryPath = `${input.settingsPath}.${process.pid}.tmp`;
      const encoded = yield* encodeSettingsJson(settings).pipe(
        Effect.mapError(
          (cause) =>
            new AppServerSettingsStoreError({
              operation: "encode",
              path: input.settingsPath,
              cause,
            }),
        ),
      );
      const writeError = (path: string, cause: unknown) =>
        new AppServerSettingsStoreError({ operation: "write", path, cause });
      yield* input.fileSystem
        .makeDirectory(directory, { recursive: true })
        .pipe(Effect.mapError((cause) => writeError(directory, cause)));
      yield* input.fileSystem
        .writeFileString(temporaryPath, `${encoded}\n`, { mode: 0o600 })
        .pipe(Effect.mapError((cause) => writeError(temporaryPath, cause)));
      yield* input.fileSystem
        .rename(temporaryPath, input.settingsPath)
        .pipe(Effect.mapError((cause) => writeError(input.settingsPath, cause)));
      return settings;
    });

  return { read, write };
}
