import { AgentAttemptEventKind } from './agent-events.ts';
import type { AgentAttemptEvent } from './agent-events.ts';
import type { RuntimeActivityObservation } from './events.ts';

export function cortexActionId(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('Cortex action sequence must be a positive integer.');
  }
  return `a${sequence.toString().padStart(4, '0')}`;
}

export function renderAgentAttemptEvent(event: AgentAttemptEvent): string {
  const identity = `${event.task}/attempt-${event.attempt}:${event.actionId}`;
  return `[${identity}] ${event.kind}\n`;
}

type RenderRuntimeActivityObservationArgs = {
  readonly identity: {
    readonly task: string;
    readonly attempt: number;
    readonly sequence: number;
  };
  readonly observation: RuntimeActivityObservation;
};

export function renderRuntimeActivityObservation(
  args: RenderRuntimeActivityObservationArgs,
): string {
  const identity = args.identity;
  const observation = args.observation;
  const references = (observation.cortexReferences ?? [])
    .map((reference) => `${reference.id}:${reference.relation}`)
    .join(' ');
  return `[${identity.task}/attempt-${identity.attempt}:live-${cortexActionId(identity.sequence)}] runtime-activity ${observation.activity}${references ? ` ${references}` : ''}\n`;
}
