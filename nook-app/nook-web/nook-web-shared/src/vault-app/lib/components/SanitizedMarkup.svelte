<script lang="ts">
  import DOMPurify, { type Config } from 'dompurify'

  const sanitizedFragmentConfig: Config = { RETURN_DOM_FRAGMENT: true }

  type SanitizedMarkupProps = {
    readonly html: string
  }

  class SanitizedMarkupAttachment {
    constructor(private readonly markup: string) {}

    readonly attach = (element: HTMLElement): void => {
      const fragment = DOMPurify.sanitize(this.markup, sanitizedFragmentConfig)
      element.replaceChildren(fragment)
    }
  }

  let { html }: SanitizedMarkupProps = $props()
  const attachment = $derived(new SanitizedMarkupAttachment(html))
</script>

<div {@attach attachment.attach}></div>
