/** One silhouette per surface role; see the shape vocabulary in app.css. */
export enum FrameShape {
  Dialog = "dialog",
  KeyTag = "keytag",
  Tab = "tab",
  Sheet = "sheet",
  Nick = "nick",
}

export enum FrameElement {
  Div = "div",
  Section = "section",
  Article = "article",
  Header = "header",
  ListItem = "li",
}

/** Maps a frame shape to its app.css class. */
export class FrameShapeClass {
  constructor(private readonly shape: FrameShape) {}

  get name(): string {
    switch (this.shape) {
      case FrameShape.Dialog:
        return "nk-frame";
      case FrameShape.KeyTag:
        return "nk-frame-keytag";
      case FrameShape.Tab:
        return "nk-frame-tab";
      case FrameShape.Sheet:
        return "nk-frame-sheet";
      case FrameShape.Nick:
        return "nk-frame-nick";
    }
  }
}
