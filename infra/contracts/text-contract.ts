import { err, ok, type Result } from "neverthrow";
import {
  OperationalContractFailureKind,
  type OperationalContractFailure,
} from "./operational-contract";
interface TextContractSource {
  label: string;
  source: string;
}

export class TextContract {
  constructor(private readonly input: TextContractSource) {}

  require(fragment: string): Result<void, OperationalContractFailure> {
    if (!this.input.source.includes(fragment)) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `${this.input.label} is missing required contract: ${fragment}`,
      });
    }
    return ok();
  }

  requireAll(fragments: string[]): Result<void, OperationalContractFailure> {
    for (const fragment of fragments) {
      const result = this.require(fragment);
      if (result.isErr()) return err(result.error);
    }
    return ok();
  }

  forbid(fragment: string): Result<void, OperationalContractFailure> {
    if (this.input.source.includes(fragment)) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `${this.input.label} contains prohibited contract: ${fragment}`,
      });
    }
    return ok();
  }

  forbidAll(fragments: string[]): Result<void, OperationalContractFailure> {
    for (const fragment of fragments) {
      const result = this.forbid(fragment);
      if (result.isErr()) return err(result.error);
    }
    return ok();
  }

  count(input: {
    fragment: string;
    expected: number;
  }): Result<void, OperationalContractFailure> {
    const actual = this.input.source.split(input.fragment).length - 1;
    if (actual !== input.expected) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `${this.input.label} expected ${input.expected} copies of ${input.fragment}, found ${actual}`,
      });
    }
    return ok();
  }

  requireBefore(input: {
    first: string;
    second: string;
  }): Result<void, OperationalContractFailure> {
    const firstIndex = this.input.source.indexOf(input.first);
    const secondIndex = this.input.source.indexOf(input.second);
    if (firstIndex < 0 || secondIndex < 0 || firstIndex > secondIndex) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `${this.input.label} must place ${input.first} before ${input.second}`,
      });
    }
    return ok();
  }
}
