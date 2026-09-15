import { TaskResourceClaim } from '../agent-workflow/domain.ts';

import {
  ModuleDeliveryIssueCode,
  type ModuleDeliveryIssue,
  type ModuleDeliveryNodeV2,
} from './domain.ts';

/** Owns the resource scopes attached to external acceptance references. */
export class ModuleDeliveryAcceptanceScopeValidation {
  private constructor(private readonly request: AcceptanceScopeRequest) {}

  static validate(
    request: AcceptanceScopeRequest,
  ): readonly ModuleDeliveryIssue[] {
    return new ModuleDeliveryAcceptanceScopeValidation(request).execute();
  }

  private execute(): readonly ModuleDeliveryIssue[] {
    const issues: ModuleDeliveryIssue[] = [];
    const commands = this.request.node.acceptance.commands;
    const selectors = commands.map(({ selector }) => selector);
    if (new Set(selectors).size !== selectors.length)
      issues.push({
        code: ModuleDeliveryIssueCode.DuplicateValue,
        path: `${this.request.path}.acceptance.commands`,
        message: 'List values must be unique.',
      });
    for (const [index, command] of commands.entries()) {
      const scopes = [
        ['read', command.read, this.request.node.resources.read],
        ['write', command.write, this.request.node.resources.write],
        ['output', command.output, this.request.node.resources.evidenceSurface],
      ] as const;
      for (const [name, claims, allowedClaims] of scopes) {
        const path = `${this.request.path}.acceptance.commands[${index}].${name}`;
        for (const [claimIndex, claim] of claims.entries()) {
          if (!TaskResourceClaim.isValidTaskResourceClaim(claim))
            issues.push({
              code: ModuleDeliveryIssueCode.InvalidField,
              path: `${path}[${claimIndex}]`,
              message: `Invalid resource claim ${claim}.`,
            });
          if (!allowedClaims.includes(claim))
            issues.push({
              code: ModuleDeliveryIssueCode.InvalidField,
              path,
              message: `Acceptance command scope ${claim} is not declared by the task resources.`,
            });
        }
      }
    }
    return issues;
  }
}

type AcceptanceScopeRequest = Readonly<{
  readonly path: string;
  readonly node: ModuleDeliveryNodeV2;
}>;
