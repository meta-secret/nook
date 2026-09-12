export enum OvhFailureKind {
  Schema = "schema", Arguments = "arguments", Endpoint = "endpoint",
  Network = "network", Http = "http", Filesystem = "filesystem",
  Command = "command", Identity = "identity", Template = "template",
  RecoveryMarker = "recovery-marker", ReinstallRefused = "reinstall-refused",
  Consumed = "consumed", Timeout = "timeout", Task = "task",
}
export class OvhFailure {
  constructor(readonly kind: OvhFailureKind, readonly message: string) {}
}
