import DOMPurify from 'dompurify'

const TRANSLATION_MARKUP = {
  ALLOWED_ATTR: [],
  ALLOWED_TAGS: ['br', 'code'],
  RETURN_DOM: true,
}

export function replaceWithSafeTranslationHtml(element, html) {
  const sanitizedBody = DOMPurify.sanitize(html, TRANSLATION_MARKUP)
  const sanitizedNodes = Array.from(sanitizedBody.childNodes, (node) =>
    node.cloneNode(true),
  )
  element.replaceChildren(...sanitizedNodes)
}
