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
  translationPrefix="proton_pass_import"
  panelTestId="proton-pass-import-panel"
  fileTestId="proton-pass-export-file"
  submitTestId="proton-pass-import-submit"
  errorTestId="proton-pass-import-error"
  resultTestId="proton-pass-import-result"
  accept=".zip,.json,application/zip,application/x-zip-compressed,application/json"
  icon={PasswordImportIcon.Archive}
/>
