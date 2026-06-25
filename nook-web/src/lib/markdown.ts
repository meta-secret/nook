import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

md.disable('image')

/** Render markdown to HTML (secure-note preview and display). Raw HTML in source is disabled. */
export function renderMarkdown(source: string): string {
  if (!source.trim()) return ''

  const rawHtml = md.render(source)

  // Transform task lists [ ] and [x] into checkbox inputs
  const withChecklists = rawHtml
    .replace(/<li>\[ \]/g, '<li><input type="checkbox" disabled />')
    .replace(/<li>\[x\]/g, '<li><input type="checkbox" checked disabled />')
    .replace(/<li>\[ \] /g, '<li><input type="checkbox" disabled /> ')
    .replace(/<li>\[x\] /g, '<li><input type="checkbox" checked disabled /> ')

  return withChecklists
}
