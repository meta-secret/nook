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
  translationPrefix="dashlane_import"
  panelTestId="dashlane-import-panel"
  fileTestId="dashlane-export-file"
  submitTestId="dashlane-import-submit"
  errorTestId="dashlane-import-error"
  resultTestId="dashlane-import-result"
  accept=".csv,.zip,text/csv,application/zip,application/x-zip-compressed"
  icon={PasswordImportIcon.Archive}
/>
