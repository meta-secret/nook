import MarkdownIt from "markdown-it";

const MarkdownItArgs: Exclude<
  ConstructorParameters<typeof MarkdownIt>[0],
  string | undefined
> = {
  html: false,
  linkify: true,
  breaks: true,
};

/** Owns the browser runtime resources shared by these interactions. */
class MarkdownRenderer {
  constructor() {
    this.md.disable("image");
  }
  private md = new MarkdownIt(MarkdownItArgs);
  renderMarkdown(source: string): string {
    if (!source.trim()) return "";

    const rawHtml = this.md.render(source);

    // Transform task lists [ ] and [x] into checkbox inputs
    const withChecklists = rawHtml
      .replace(/<li>\[ \]/g, '<li><input type="checkbox" disabled />')
      .replace(/<li>\[x\]/g, '<li><input type="checkbox" checked disabled />')
      .replace(/<li>\[ \] /g, '<li><input type="checkbox" disabled /> ')
      .replace(
        /<li>\[x\] /g,
        '<li><input type="checkbox" checked disabled /> ',
      );

    return withChecklists;
  }
}

export const markdownRenderer = new MarkdownRenderer();
