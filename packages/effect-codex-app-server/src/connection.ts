export interface LocalAppServerConnectionSettings {
  readonly kind: "local";
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly workspace: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface SshAppServerConnectionSettings {
  readonly kind: "ssh";
  readonly host: string;
  readonly username: string;
  readonly port: number | null;
  readonly identityFile: string;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly workspace: string;
  readonly env: Readonly<Record<string, string>>;
}

export type AppServerConnectionSettings =
  | LocalAppServerConnectionSettings
  | SshAppServerConnectionSettings;

export interface AppServerConnectionProfile {
  readonly id: string;
  readonly name: string;
  readonly connection: AppServerConnectionSettings;
}

export interface AppServerDesktopSettings {
  readonly connections: ReadonlyArray<AppServerConnectionProfile>;
}

export interface DiscoveredSshHost {
  readonly alias: string;
  readonly source: "ssh-config" | "known-hosts";
}
