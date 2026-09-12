import type { CortexRuntimeContract } from './domain.ts';

export enum CortexRuntimeCommandKind {
  Runtime = 'runtime',
  Other = 'other',
}

export enum CortexRuntimePrefixRelationship {
  Matches = 'matches',
  Unrelated = 'unrelated',
}

export enum CortexRuntimeRegistration {
  Registered = 'registered',
  Unregistered = 'unregistered',
  OutsideRuntime = 'outside-runtime',
}

export class CortexRuntimeCommand {
  readonly text: string;

  constructor(command: string) {
    this.text = command.replaceAll(/\s+/gu, ' ').trim();
  }

  kind(): CortexRuntimeCommandKind {
    return this.text.startsWith('task ') ||
      /^loom-[A-Za-z0-9:_-]+/u.test(this.text)
      ? CortexRuntimeCommandKind.Runtime
      : CortexRuntimeCommandKind.Other;
  }

  relationshipTo(prefix: string): CortexRuntimePrefixRelationship {
    return this.text === prefix || this.text.startsWith(`${prefix} `)
      ? CortexRuntimePrefixRelationship.Matches
      : CortexRuntimePrefixRelationship.Unrelated;
  }
}

export class CortexRuntimeEntrypoints {
  constructor(private readonly contract: CortexRuntimeContract) {}

  registrationOf(command: CortexRuntimeCommand): CortexRuntimeRegistration {
    if (command.kind() === CortexRuntimeCommandKind.Other) {
      return CortexRuntimeRegistration.OutsideRuntime;
    }
    const prefixes = [
      ...this.contract.allowedCommandPrefixes,
      ...this.contract.retiredCommandPrefixes,
    ];
    return prefixes.some(
      (prefix) =>
        command.relationshipTo(prefix) ===
        CortexRuntimePrefixRelationship.Matches,
    )
      ? CortexRuntimeRegistration.Registered
      : CortexRuntimeRegistration.Unregistered;
  }
}
