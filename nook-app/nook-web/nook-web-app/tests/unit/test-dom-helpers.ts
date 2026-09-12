/** Runtime-checked DOM helpers keep test assertions type-safe without casts. */
export function requireInputElement(element: Element): HTMLInputElement {
  if (!(element instanceof HTMLInputElement))
    throw new TypeError('expected an input element')
  return element
}

export function requireButtonElement(element: Element): HTMLButtonElement {
  if (!(element instanceof HTMLButtonElement))
    throw new TypeError('expected a button element')
  return element
}
