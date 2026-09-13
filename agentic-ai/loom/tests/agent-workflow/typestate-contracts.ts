import {
  AgentAttemptJournal,
  ActiveAgentAttemptJournal,
  type ActiveModuleExpertJournal,
  type ActiveStructuralExpertJournal,
  type AgentAttemptJournalConfiguration,
} from '../../src/agent-workflow/agent-journal.ts';
import {
  ModuleExpertRuntimeSession,
  ModuleExpertRuntimeCapabilityKind,
} from '../../src/module-experts/trusted-runtime.ts';
import { ReadOnlyExpertRuntimeIsolation } from '../../src/module-experts/runtime-contract.ts';
import { DelegationLifecycleLease } from '../../src/agent-workflow/delegation-run-journal.ts';

/** Compile-only examples: never invoked by the runtime test harness. */
export class ForbiddenExpertTransitions {
  static beforeInitialization(
    configuration: AgentAttemptJournalConfiguration,
  ): void {
    const prepared = new AgentAttemptJournal(configuration);
    // @ts-expect-error A prepared journal cannot write activity.
    void prepared.observe;
    // @ts-expect-error Advanced journal construction belongs to initialization.
    ActiveAgentAttemptJournal({});
  }
  static adapterCompletion(journal: ActiveModuleExpertJournal<string>): void {
    // @ts-expect-error Module journals cannot consume structural completion authority.
    void journal.finalizeStructuralExpert;
  }
  static structuralCompletion(
    journal: ActiveStructuralExpertJournal<string>,
  ): void {
    // @ts-expect-error Structural journals cannot consume module completion authority.
    void journal.finalizeModuleExpert;
  }
  static capabilityConstruction(): void {
    // @ts-expect-error Runtime authority classes cannot be fabricated from their discriminator.
    const session: ModuleExpertRuntimeSession = {
      kind: ModuleExpertRuntimeCapabilityKind.Session,
    };
    void session;
    // @ts-expect-error Only successful isolation setup can construct live resources.
    new ReadOnlyExpertRuntimeIsolation({});
    // @ts-expect-error A lock cannot be fabricated from a raw database handle.
    new DelegationLifecycleLease({});
  }
}
