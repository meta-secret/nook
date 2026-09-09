export class SuccessfulFieldDecode<T> {
  private constructor(private readonly request: T) {}
  static create<T>(value: T): DecodeOutcome<T> {
    return new SuccessfulFieldDecode<T>(value).execute();
  }
  private execute(): DecodeOutcome<T> {
    const value = this.request;
    return { status: DecodeStatus.Ok, value };
  }
}

export class FailedFieldDecode {
  private constructor(private readonly request: DecodeFieldErrors) {}
  static create(errors: DecodeFieldErrors): DecodeOutcome<never> {
    return new FailedFieldDecode(errors).execute();
  }
  private execute(): DecodeOutcome<never> {
    const errors = this.request;
    return { status: DecodeStatus.Failed, errors };
  }
}

export class FieldDiagnostic {
  private constructor(private readonly request: FieldErrorArgs) {}
  static create(args: FieldErrorArgs): FieldError {
    return new FieldDiagnostic(args).execute();
  }
  private execute(): FieldError {
    const args = this.request;
    return {
      path: args.path,
      issue: args.issue,
      detail: 'detail' in args ? args.detail : { kind: FieldDetailKind.None },
    };
  }
}

export class FieldDiagnosticText {
  private constructor(private readonly request: string) {}
  static create(text: string): FieldDetail {
    return new FieldDiagnosticText(text).execute();
  }
  private execute(): FieldDetail {
    const text = this.request;
    return { kind: FieldDetailKind.Text, text };
  }
}

export class FieldPath {
  private constructor(private readonly request: JoinPathArgs) {}
  static join(args: JoinPathArgs): string {
    return new FieldPath(args).execute();
  }
  private execute(): string {
    const args = this.request;
    if (args.base.length === 0) {
      return args.key;
    }
    return `${args.base}.${args.key}`;
  }
}

export class FieldDiagnosticMessage {
  private constructor(private readonly request: FieldError) {}
  static render(error: FieldError): string {
    return new FieldDiagnosticMessage(error).execute();
  }
  private execute(): string {
    const error = this.request;
    switch (error.issue) {
      case FieldIssue.UnknownField:
        return 'unknown field';
      case FieldIssue.ExpectedObject:
        return 'expected object';
      case FieldIssue.MissingRequiredField:
        return 'missing required field';
      case FieldIssue.ExpectedBoolean:
        return 'expected boolean';
      case FieldIssue.ExpectedString:
        return 'expected string';
      case FieldIssue.ExpectedPositiveInteger:
        return 'expected positive integer';
      case FieldIssue.ExpectedOneOf:
        return error.detail.kind === FieldDetailKind.Text
          ? error.detail.text
          : 'expected one of allowed values';
      case FieldIssue.ExpectedRemoteTaskString:
        return 'expected string, YAML null, or omitted';
      case FieldIssue.ExpectedKebabCaseSlug:
        return 'expected kebab-case slug [a-z0-9-]+';
      case FieldIssue.ExpectedExactlyOneDomainKey:
        return error.detail.kind === FieldDetailKind.Text
          ? error.detail.text
          : 'expected exactly one domain request key; see toolsList for known families';
      case FieldIssue.ExpectedExactlyOneOperationKey:
        return error.detail.kind === FieldDetailKind.Text
          ? error.detail.text
          : 'expected exactly one operation key';
      case FieldIssue.NestedToolsCallNotAllowed:
        return 'nested toolsCall is not allowed inside toolsCall';
      case FieldIssue.ExpectedNestedDomainRequest:
        return 'expected nested domain request object';
      case FieldIssue.ExecuteFailed:
        return error.detail.kind === FieldDetailKind.Text
          ? error.detail.text
          : 'execution failed';
      case FieldIssue.InvalidYaml:
        // Parse detail lives on explanation.changes[syntaxInvalid].parseMessage.
        return 'invalid YAML';
      case FieldIssue.RequestFileReadFailed:
        return error.detail.kind === FieldDetailKind.Text
          ? error.detail.text
          : 'failed to read request file';
    }
  }
}
export enum FieldIssue {
  UnknownField = 'unknownField',
  ExpectedObject = 'expectedObject',
  MissingRequiredField = 'missingRequiredField',
  ExpectedBoolean = 'expectedBoolean',
  ExpectedString = 'expectedString',
  ExpectedPositiveInteger = 'expectedPositiveInteger',
  ExpectedOneOf = 'expectedOneOf',
  ExpectedRemoteTaskString = 'expectedRemoteTaskString',
  ExpectedKebabCaseSlug = 'expectedKebabCaseSlug',
  ExpectedExactlyOneDomainKey = 'expectedExactlyOneDomainKey',
  ExpectedExactlyOneOperationKey = 'expectedExactlyOneOperationKey',
  NestedToolsCallNotAllowed = 'nestedToolsCallNotAllowed',
  ExpectedNestedDomainRequest = 'expectedNestedDomainRequest',
  ExecuteFailed = 'executeFailed',
  InvalidYaml = 'invalidYaml',
  RequestFileReadFailed = 'requestFileReadFailed',
}

export enum DecodeStatus {
  Ok = 'ok',
  Failed = 'failed',
}

export enum FieldDetailKind {
  None = 'none',
  Text = 'text',
}

export type FieldDetail =
  | { readonly kind: FieldDetailKind.None }
  | { readonly kind: FieldDetailKind.Text; readonly text: string };

export type FieldError = {
  readonly path: string;
  readonly issue: FieldIssue;
  readonly detail: FieldDetail;
};

export type DecodeOutcome<T> =
  | { readonly status: DecodeStatus.Ok; readonly value: T }
  | {
      readonly status: DecodeStatus.Failed;
      readonly errors: readonly FieldError[];
    };

export type DecodeFieldErrors = readonly FieldError[];

export type FieldErrorArgs =
  | { readonly path: string; readonly issue: FieldIssue }
  | {
      readonly path: string;
      readonly issue: FieldIssue;
      readonly detail: FieldDetail;
    };

export type JoinPathArgs = {
  readonly base: string;
  readonly key: string;
};
