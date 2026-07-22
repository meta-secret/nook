<script lang="ts">
  import PasswordManagerImportPanel from '$lib/components/PasswordManagerImportPanel.svelte'
  import type { ImportPanelProps } from '$lib/components/import-panel'

  let props: ImportPanelProps<Uint8Array> = $props()
</script>

<PasswordManagerImportPanel
  {...props}
  format="binary"
  translationPrefix="proton_pass_import"
  panelTestId="proton-pass-import-panel"
  fileTestId="proton-pass-export-file"
  submitTestId="proton-pass-import-submit"
  errorTestId="proton-pass-import-error"
  resultTestId="proton-pass-import-result"
  accept=".zip,.json,application/zip,application/x-zip-compressed,application/json"
  icon="archive"
/>
