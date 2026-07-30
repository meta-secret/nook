<script lang="ts">
  import PasswordManagerImportPanel from '$lib/components/PasswordManagerImportPanel.svelte'
  import type { ImportPanelProps } from '$lib/components/import-panel'
  import {
    PasswordImportFormat,
    PasswordImportIcon,
  } from './password-manager-import-state'

  let props: ImportPanelProps<Uint8Array> = $props()
</script>

<PasswordManagerImportPanel
  {...props}
  format={PasswordImportFormat.Binary}
  translationPrefix="onepassword_import"
  panelTestId="onepassword-import-panel"
  fileTestId="onepassword-pux-file"
  submitTestId="onepassword-import-submit"
  errorTestId="onepassword-import-error"
  resultTestId="onepassword-import-result"
  accept=".1pux,application/zip,application/x-zip-compressed"
  icon={PasswordImportIcon.Archive}
/>
