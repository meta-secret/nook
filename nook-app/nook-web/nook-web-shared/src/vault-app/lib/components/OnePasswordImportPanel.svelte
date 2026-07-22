<script lang="ts">
  import PasswordManagerImportPanel from '$lib/components/PasswordManagerImportPanel.svelte'
  import type { ImportPanelProps } from '$lib/components/import-panel'

  let props: ImportPanelProps<Uint8Array> = $props()
</script>

<PasswordManagerImportPanel
  {...props}
  format="binary"
  translationPrefix="onepassword_import"
  panelTestId="onepassword-import-panel"
  fileTestId="onepassword-pux-file"
  submitTestId="onepassword-import-submit"
  errorTestId="onepassword-import-error"
  resultTestId="onepassword-import-result"
  accept=".1pux,application/zip,application/x-zip-compressed"
  icon="archive"
/>
