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

export function decodeOk<T>(value: T): DecodeOutcome<T> {
  return { status: DecodeStatus.Ok, value };
}

export function decodeErr(errors: readonly FieldError[]): DecodeOutcome<never> {
  return { status: DecodeStatus.Failed, errors };
}

export function fieldError(
  path: string,
  issue: FieldIssue,
  detail: FieldDetail = { kind: FieldDetailKind.None },
): FieldError {
  return { path, issue, detail };
}

export function fieldDetailText(text: string): FieldDetail {
  return { kind: FieldDetailKind.Text, text };
}

export function joinPath(base: string, key: string): string {
  if (base.length === 0) {
    return key;
  }
  return `${base}.${key}`;
}

export function fieldIssueMessage(error: FieldError): string {
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
