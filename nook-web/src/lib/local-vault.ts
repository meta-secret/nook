export { hasActiveLocalVault, hasLocalVault } from './nook-wasm/nook_wasm'
export {
  importVaultAsNewLocalCopy,
  listLocalVaultEntries,
  prepareCreateNewVaultSlot,
  readActiveVaultStoreId,
  switchActiveVault,
  type LocalVaultEntry,
} from './vault-registry'
