import type { ModuleDeliveryIntegratedWriterFrontierCapability } from './integration.ts';
import type { ModuleIntegrationState } from './integration-provenance.ts';

const STATE_WRITER_FRONTIERS = new WeakMap<
  ModuleIntegrationState,
  readonly ModuleDeliveryIntegratedWriterFrontierCapability[]
>();

export type RegisterModuleDeliveryWriterFrontiersRequest = Readonly<{
  state: ModuleIntegrationState;
  writerFrontiers: readonly ModuleDeliveryIntegratedWriterFrontierCapability[];
}>;

export function registerModuleDeliveryWriterFrontiers(
  request: RegisterModuleDeliveryWriterFrontiersRequest,
): void {
  STATE_WRITER_FRONTIERS.set(request.state, request.writerFrontiers);
}

export function moduleDeliveryWriterFrontiers(
  state: ModuleIntegrationState,
): readonly ModuleDeliveryIntegratedWriterFrontierCapability[] {
  const capabilities = STATE_WRITER_FRONTIERS.get(state);
  if (!capabilities)
    throw new Error('Module integration writer frontiers are unregistered.');
  return capabilities;
}
