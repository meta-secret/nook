import type QrScanner from "qr-scanner";
import type { NookImportResult } from "$lib/nook";

export enum ScannerLifecycleKind {
  NotCreated = "not-created",
  Created = "created",
}

export type ScannerLifecycle =
  | { kind: ScannerLifecycleKind.NotCreated }
  | { kind: ScannerLifecycleKind.Created; scanner: QrScanner };

export enum AuthenticatorImportOutcomeKind {
  NotRun = "not-run",
  Completed = "completed",
}

export type AuthenticatorImportOutcome =
  | { kind: AuthenticatorImportOutcomeKind.NotRun }
  | {
      kind: AuthenticatorImportOutcomeKind.Completed;
      result: NookImportResult;
    };
