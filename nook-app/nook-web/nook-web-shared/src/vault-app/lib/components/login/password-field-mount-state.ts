export enum PasswordFieldMountKind {
  Unmounted = "unmounted",
  Mounted = "mounted",
}

export type PasswordFieldMount =
  | { kind: PasswordFieldMountKind.Unmounted }
  | { kind: PasswordFieldMountKind.Mounted; element: HTMLInputElement };
