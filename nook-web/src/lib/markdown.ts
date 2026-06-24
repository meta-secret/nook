import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

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

  // Sanitize the HTML to prevent XSS
  return DOMPurify.sanitize(withChecklists, {
    USE_PROFILES: { html: true },
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'ul',
      'ol',
      'li',
      'strong',
      'em',
      'del',
      'code',
      'pre',
      'a',
      'blockquote',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'input',
    ],
    ALLOWED_ATTR: [
      'href',
      'target',
      'rel',
      'title',
      'type',
      'checked',
      'disabled',
    ],
  })
}
