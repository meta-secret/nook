import DOMPurify from 'dompurify'

const TRANSLATION_MARKUP = {
  ALLOWED_ATTR: [],
  ALLOWED_TAGS: ['br', 'code'],
  RETURN_DOM_FRAGMENT: true,
}

export function replaceWithSafeTranslationHtml(element, html) {
  const fragment = DOMPurify.sanitize(html, TRANSLATION_MARKUP)
  const sanitizedNodes = Array.from(fragment.childNodes, (node) =>
    node.cloneNode(true),
  )
  element.replaceChildren(...sanitizedNodes)
}
