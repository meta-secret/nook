import MarkdownIt from "markdown-it";

const MarkdownItArgs: ConstructorParameters<typeof MarkdownIt>[0] = {
  html: false,
  linkify: true,
  breaks: true,
};
const md = new MarkdownIt(MarkdownItArgs);

md.disable("image");

/** Render markdown to HTML (secure-note preview and display). Raw HTML in source is disabled. */
export function renderMarkdown(source: string): string {
  if (!source.trim()) return "";

  const rawHtml = md.render(source);

  // Transform task lists [ ] and [x] into checkbox inputs
  const withChecklists = rawHtml
    .replace(/<li>\[ \]/g, '<li><input type="checkbox" disabled />')
    .replace(/<li>\[x\]/g, '<li><input type="checkbox" checked disabled />')
    .replace(/<li>\[ \] /g, '<li><input type="checkbox" disabled /> ')
    .replace(/<li>\[x\] /g, '<li><input type="checkbox" checked disabled /> ');

  return withChecklists;
}
