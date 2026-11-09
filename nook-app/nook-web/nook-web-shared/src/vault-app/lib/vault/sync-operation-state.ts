import type { NookStorageConnection } from "$app-wasm";
import type { StorageProvider } from "$lib/auth/providers";

export enum EventOutboxTargetKind {
  Unavailable = "unavailable",
  LocalFolder = "local-folder",
  Remote = "remote",
}

export type EventOutboxTarget =
  | { kind: EventOutboxTargetKind.Unavailable }
  | {
      kind: EventOutboxTargetKind.LocalFolder;
      provider: StorageProvider;
    }
  | {
      kind: EventOutboxTargetKind.Remote;
      args: NookStorageConnection;
    };

export enum EventOutboxRequestKind {
  Default = "default",
  LocalFolder = "local-folder",
  Remote = "remote",
}

export type EventOutboxRequest =
  | { kind: EventOutboxRequestKind.Default }
  | {
      kind: EventOutboxRequestKind.LocalFolder;
      provider: StorageProvider;
    }
  | {
      kind: EventOutboxRequestKind.Remote;
      provider: StorageProvider;
    };

export class ProviderEventOutbox {
  constructor(private readonly provider: StorageProvider) {}
  request(): EventOutboxRequest {
    return this.provider.provider.type === "local-folder"
      ? { kind: EventOutboxRequestKind.LocalFolder, provider: this.provider }
      : { kind: EventOutboxRequestKind.Remote, provider: this.provider };
  }
}
