import { AgentAttemptEventKind } from './agent-events.ts';
import type { AgentAttemptEvent } from './agent-events.ts';

export function cortexActionId(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('Cortex action sequence must be a positive integer.');
  }
  return `a${sequence.toString().padStart(4, '0')}`;
}

export function renderAgentAttemptEvent(event: AgentAttemptEvent): string {
  const identity = `${event.task}/attempt-${event.attempt}:${event.actionId}`;
  const activity =
    event.kind === AgentAttemptEventKind.RuntimeActivity
      ? `${event.kind} ${event.activity}`
      : event.kind;
  const references =
    event.kind === AgentAttemptEventKind.RuntimeActivity
      ? event.cortexReferences
          .map((reference) => `${reference.id}:${reference.relation}`)
          .join(' ')
      : '';
  return `[${identity}] ${activity}${references ? ` ${references}` : ''}\n`;
}
