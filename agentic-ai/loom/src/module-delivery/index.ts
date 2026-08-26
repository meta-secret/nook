export { decodeAndValidateModuleDeliveryPlan } from './validation.ts';
export { cleanupModuleWorktree, prepareModuleWorktree } from './workspace.ts';
export { verifyModuleCommitHandoff } from './handoff.ts';
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
