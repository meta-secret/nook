<script lang="ts">
  import { ApplicationRoutePresentation } from '$lib/content/legal'
</script>

<footer
  class="mx-auto mt-6 flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 pb-6 text-xs text-muted-foreground sm:px-6"
  data-testid="site-footer"
>
  <a
    href={new ApplicationRoutePresentation('/').appPath()}
    class="underline-offset-4 hover:text-foreground hover:underline"
    data-testid="footer-about-link"
  >
    About
  </a>
  <span aria-hidden="true">·</span>
  <a
    href={new ApplicationRoutePresentation('/privacy.html').appPath()}
    class="underline-offset-4 hover:text-foreground hover:underline"
    data-testid="footer-privacy-link"
  >
    Privacy
  </a>
  <span aria-hidden="true">·</span>
  <a
    href={new ApplicationRoutePresentation('/terms.html').appPath()}
    class="underline-offset-4 hover:text-foreground hover:underline"
    data-testid="footer-terms-link"
  >
    Terms
  </a>
  <span aria-hidden="true">·</span>
  <a
    href="https://github.com/meta-secret/nook"
    target="_blank"
    rel="noreferrer"
    class="underline-offset-4 hover:text-foreground hover:underline"
    data-testid="footer-github-link"
  >
    GitHub
  </a>
</footer>
