import { err, ok, type Result } from 'neverthrow';
import { LoomFailureCode } from '../loom-failure.ts';
import {
  UntrustedYamlBoundary,
  UntrustedYamlPropertyPresence,
  type UntrustedYamlNode,
} from './guards.ts';
import type {
  GitHubEvidenceFailure,
  GitHubPropertyRequest,
} from './agent-stats-github-api.ts';

export class GitHubEvidenceField {
  constructor(private readonly request: GitHubPropertyRequest) {}

  string(): Result<string, GitHubEvidenceFailure> {
    const property = UntrustedYamlBoundary.property(this.request);
    if (
      property.presence === UntrustedYamlPropertyPresence.Absent ||
      typeof property.value !== 'string' ||
      property.value.length === 0
    ) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `GitHub field ${this.request.key} must be a non-empty string`,
      });
    }
    return ok(property.value);
  }

  number(): Result<number, GitHubEvidenceFailure> {
    const property = UntrustedYamlBoundary.property(this.request);
    if (
      property.presence === UntrustedYamlPropertyPresence.Absent ||
      typeof property.value !== 'number' ||
      !Number.isInteger(property.value) ||
      property.value < 0
    ) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `GitHub field ${this.request.key} must be a non-negative integer`,
      });
    }
    return ok(property.value);
  }

  array(): Result<readonly UntrustedYamlNode[], GitHubEvidenceFailure> {
    const property = UntrustedYamlBoundary.property(this.request);
    if (
      property.presence === UntrustedYamlPropertyPresence.Absent ||
      !Array.isArray(property.value)
    ) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `GitHub field ${this.request.key} must be a list`,
      });
    }
    return ok(property.value);
  }
}
