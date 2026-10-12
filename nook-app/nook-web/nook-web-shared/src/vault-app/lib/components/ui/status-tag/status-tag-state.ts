export enum StatusTone {
  Neutral = "neutral",
  Success = "success",
  Warning = "warning",
  Danger = "danger",
}

/** Leading mark: a coloured dot, the caller's icon snippet, or nothing. */
export enum StatusMark {
  Dot = "dot",
  Icon = "icon",
  None = "none",
}

export class StatusToneClass {
  constructor(private readonly tone: StatusTone) {}

  get name(): string {
    switch (this.tone) {
      case StatusTone.Neutral:
        return "";
      case StatusTone.Success:
        return "nk-tag-success";
      case StatusTone.Warning:
        return "nk-tag-warning";
      case StatusTone.Danger:
        return "nk-tag-danger";
    }
  }
}
