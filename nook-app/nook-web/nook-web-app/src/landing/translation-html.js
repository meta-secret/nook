import DOMPurify from 'dompurify'

const TRANSLATION_MARKUP = {
  ALLOWED_ATTR: [],
  ALLOWED_TAGS: ['br', 'code'],
}

export function replaceWithSafeTranslationHtml(element, html) {
  const sanitizedHtml = DOMPurify.sanitize(html, TRANSLATION_MARKUP)
  const inertDocument = new DOMParser().parseFromString(
    sanitizedHtml,
    'text/html',
  )
  const sanitizedNodes = Array.from(inertDocument.body.childNodes, (node) =>
    node.cloneNode(true),
  )
  element.replaceChildren(...sanitizedNodes)
}
