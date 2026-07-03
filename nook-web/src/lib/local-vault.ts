export { hasActiveLocalVault, hasLocalVault } from './nook-wasm/nook_wasm'
export {
  importVaultAsNewLocalCopy,
  listLocalVaultEntries,
  prepareCreateNewVaultSlot,
  readActiveVaultStoreId,
  renameLocalVault,
  switchActiveVault,
  type LocalVaultEntry,
} from './vault-registry'
