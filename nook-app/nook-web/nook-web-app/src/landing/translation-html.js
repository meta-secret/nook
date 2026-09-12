import DOMPurify from 'dompurify'

/** @type {import('dompurify').Config & { RETURN_DOM_FRAGMENT: true }} */
const TRANSLATION_MARKUP = {
  ALLOWED_ATTR: [],
  ALLOWED_TAGS: ['br', 'code'],
  RETURN_DOM_FRAGMENT: true,
}

/**
 * @param {Element} element
 * @param {string} html
 */
export function replaceWithSafeTranslationHtml(element, html) {
  const fragment = DOMPurify.sanitize(html, TRANSLATION_MARKUP)
  const sanitizedNodes = Array.from(fragment.childNodes)
  element.replaceChildren(...sanitizedNodes)
}
