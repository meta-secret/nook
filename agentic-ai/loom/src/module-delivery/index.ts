export { decodeAndValidateModuleDeliveryPlan } from './validation.ts';
export { decodeCompatibleModuleDeliveryPlan } from './codec.ts';
export { cleanupModuleWorktree, prepareModuleWorktree } from './workspace.ts';
export { verifyModuleCommitHandoff } from './handoff.ts';
export {
  cleanupModuleIntegration,
  integrateVerifiedModuleDeliveryWave,
  MODULE_DELIVERY_INTEGRATION_INACTIVE_MESSAGE,
  prepareModuleIntegration,
} from './integration.ts';
export * from './domain.ts';
export type {
  CleanupModuleWorktreeRequest,
  CleanupModuleWorktreeResult,
  ModuleWorktreeHandle,
  PrepareModuleWorktreeRequest,
} from './workspace.ts';
export type {
  VerifiedModuleCommitHandoff,
  VerifyModuleCommitHandoffRequest,
} from './handoff.ts';
export type {
  CleanupModuleIntegrationRequest,
  CleanupModuleIntegrationResult,
  IntegrateVerifiedModuleDeliveryWaveRequest,
  ModuleDeliveryHandoffSubmission,
  ModuleIntegrationCleanupHandle,
  ModuleIntegrationState,
  PrepareModuleIntegrationRequest,
} from './integration.ts';
