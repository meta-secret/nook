import { err, ok, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
export class JsonDocument {
  constructor(private readonly request: unknown) {}
  format(): Result<string, CiFailure> {
    try {
      const formatted = JSON.stringify(this.request, (_key, value) => value, 2);
      return typeof formatted === "string"
        ? ok(formatted)
        : err({
            kind: CiFailureKind.Schema,
            message: "Agent report has no JSON representation",
          });
    } catch {
      return err({
        kind: CiFailureKind.Schema,
        message: "Unable to serialize agent report",
      });
    }
  }
}
