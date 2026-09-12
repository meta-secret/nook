import type { ModuleDeliveryIntegratedWriterFrontierCapability } from './integration.ts';
import type { ModuleIntegrationState } from './integration-provenance.ts';

/** Owns the module writer frontier registry registry and its capability transitions. */
export class ModuleWriterFrontierRegistry {
  private constructor() {}
  private static readonly STATE_WRITER_FRONTIERS = new WeakMap<
    ModuleIntegrationState,
    readonly ModuleDeliveryIntegratedWriterFrontierCapability[]
  >();

  static registerModuleDeliveryWriterFrontiers(
    request: RegisterModuleDeliveryWriterFrontiersRequest,
  ): void {
    ModuleWriterFrontierRegistry.STATE_WRITER_FRONTIERS.set(
      request.state,
      request.writerFrontiers,
    );
  }

  static moduleDeliveryWriterFrontiers(
    state: ModuleIntegrationState,
  ): readonly ModuleDeliveryIntegratedWriterFrontierCapability[] {
    const capabilities =
      ModuleWriterFrontierRegistry.STATE_WRITER_FRONTIERS.get(state);
    if (!capabilities)
      throw new Error('Module integration writer frontiers are unregistered.');
    return capabilities;
  }
}

export type RegisterModuleDeliveryWriterFrontiersRequest = Readonly<{
  state: ModuleIntegrationState;
  writerFrontiers: readonly ModuleDeliveryIntegratedWriterFrontierCapability[];
}>;
