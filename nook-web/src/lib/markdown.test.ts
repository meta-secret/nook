import { describe, expect, test } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  test('renders emphasis', () => {
    const html = renderMarkdown('Use **backup** code')
    expect(html).toContain('<strong>backup</strong>')
  })

  test('renders headings and lists like GitHub preview', () => {
    const html = renderMarkdown(
      '## hi\n\n- hop\n- ley\n- la la ley\n\n**hey**',
    )
    expect(html).toContain('<h2>hi</h2>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>hop</li>')
    expect(html).toContain('<strong>hey</strong>')
  })

  test('does not pass through raw HTML', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
  })
})
