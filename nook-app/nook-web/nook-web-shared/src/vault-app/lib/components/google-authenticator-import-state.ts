import type { Fiber } from "effect";
import type { NookImportResult } from "$lib/nook";

export enum CameraScanKind {
  Off = "off",
  Scanning = "scanning",
}

/** The panel camera; a scan runs in its fiber until that fiber is interrupted. */
export type CameraScan =
  | { kind: CameraScanKind.Off }
  | { kind: CameraScanKind.Scanning; fiber: Fiber.Fiber<void> };

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
