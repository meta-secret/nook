import { describe, expect, test } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  test('renders emphasis', () => {
    const html = renderMarkdown('Use **backup** code')
    expect(html).toContain('<strong>backup</strong>')
  })

  test('renders headings and lists like GitHub preview', () => {
    const html = renderMarkdown('## hi\n\n- hop\n- ley\n- la la ley\n\n**hey**')
    expect(html).toContain('<h2>hi</h2>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>hop</li>')
    expect(html).toContain('<strong>hey</strong>')
  })

  test('does not pass through raw HTML', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
  })

  test('sanitizes javascript: URLs in links', () => {
    const html = renderMarkdown('[click here](javascript:alert(1))')
    // markdown-it rejects the javascript: schema and renders it as plain text: [click here](javascript:alert(1))
    expect(html).not.toContain('<a href=')
    expect(html).toContain('[click here](javascript:alert(1))')
  })

  test('sanitizes malicious HTML injection and event handlers', () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)" />')
    // html: false makes markdown-it escape the tags, so they are safe text
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')

    const html2 = renderMarkdown('<iframe src="javascript:alert(1)"></iframe>')
    expect(html2).not.toContain('<iframe')
    expect(html2).toContain('&lt;iframe')
  })

  test('renders task lists with checkbox inputs', () => {
    const html = renderMarkdown('- [ ] todo list item\n- [x] done list item')
    expect(html).toContain('<input disabled="" type="checkbox">')
    expect(html).toContain('<input disabled="" checked="" type="checkbox">')
    expect(html).toContain('todo list item')
    expect(html).toContain('done list item')
  })
})
