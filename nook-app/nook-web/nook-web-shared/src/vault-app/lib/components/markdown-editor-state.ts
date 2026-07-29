export enum TextareaMountKind {
  Unmounted = "unmounted",
  Mounted = "mounted",
}

export type TextareaMount =
  | { kind: TextareaMountKind.Unmounted }
  | { kind: TextareaMountKind.Mounted; element: HTMLTextAreaElement };

export enum MarkdownEditorTab {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Write = "write",
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Preview = "preview",
}
