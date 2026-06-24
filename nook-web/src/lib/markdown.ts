import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

/** Render markdown to HTML (secure-note preview and display). Raw HTML in source is disabled. */
export function renderMarkdown(source: string): string {
  if (!source.trim()) return ''
  return md.render(source)
}
