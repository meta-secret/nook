import type { AgentAttemptEvent } from './agent-events.ts';

import type { RuntimeActivityObservation } from './events.ts';

export class AgentEventPresentation {
  private constructor(private readonly request: AgentAttemptEvent) {}

  static cortexActionId(sequence: number): string {
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error('Cortex action sequence must be a positive integer.');
    }
    return `a${sequence.toString().padStart(4, '0')}`;
  }

  static renderAgentAttemptEvent(event: AgentAttemptEvent): string {
    return new AgentEventPresentation(event).execute();
  }

  private execute(): string {
    const event = this.request;
    const identity = `${event.task}/attempt-${event.attempt}:${event.actionId}`;
    return `[${identity}] ${event.kind}\n`;
  }

  static renderRuntimeActivityObservation(
    args: RenderRuntimeActivityObservationArgs,
  ): string {
    const identity = args.identity;
    const observation = args.observation;
    const [cortexReferences = []] = [observation.cortexReferences];
    const references = cortexReferences
      .map((reference) => `${reference.id}:${reference.relation}`)
      .join(' ');
    return `[${identity.task}/attempt-${identity.attempt}:live-${AgentEventPresentation.cortexActionId(identity.sequence)}] runtime-activity ${observation.activity}${references ? ` ${references}` : ''}\n`;
  }
}

type RenderRuntimeActivityObservationArgs = {
  readonly identity: {
    readonly task: string;
    readonly attempt: number;
    readonly sequence: number;
  };
  readonly observation: RuntimeActivityObservation;
};
