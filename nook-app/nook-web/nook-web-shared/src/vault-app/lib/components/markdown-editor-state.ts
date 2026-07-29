export enum TextareaMountKind {
  Unmounted = "unmounted",
  Mounted = "mounted",
}

export type TextareaMount =
  | { kind: TextareaMountKind.Unmounted }
  | { kind: TextareaMountKind.Mounted; element: HTMLTextAreaElement };
