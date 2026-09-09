import { readFileSync } from 'node:fs';

import {
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from '../lib/guards.ts';

import { LoomFailureCode, LoomFailure } from '../loom-failure.ts';

import {
  FieldIssue,
  type DecodeOutcome,
  FailedFieldDecode,
  SuccessfulFieldDecode,
  FieldDiagnosticText,
  FieldDiagnostic,
} from './field-error.ts';

import type { FieldErrorArgs } from './field-error.ts';

import type { LoomFailureDetailArgs } from '../loom-failure.ts';

export class YamlDocument {
  private constructor(private readonly text: string) {}
  static read(filePath: string): DecodeOutcome<YamlParseSuccess> {
    let text: string;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const fieldErrorArgs2: FieldErrorArgs = {
        path: '',
        issue: FieldIssue.RequestFileReadFailed,
        detail: FieldDiagnosticText.create(message),
      };
      return FailedFieldDecode.create([
        FieldDiagnostic.create(fieldErrorArgs2),
      ]);
    }
    return YamlDocument.parse(text);
  }
  static parse(text: string): DecodeOutcome<YamlParseSuccess> {
    return new YamlDocument(text).decode();
  }
  private decode(): DecodeOutcome<YamlParseSuccess> {
    const text = this.text;
    try {
      const decodeOkArgs = {
        value: UntrustedYamlBoundary.fromHost(
          Bun.YAML.parse(text) as UntrustedYamlNode,
        ),
        text,
      };
      return SuccessfulFieldDecode.create(decodeOkArgs);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const fieldErrorArgs: FieldErrorArgs = {
        path: '',
        issue: FieldIssue.InvalidYaml,
        detail: FieldDiagnosticText.create(message),
      };
      return FailedFieldDecode.create([FieldDiagnostic.create(fieldErrorArgs)]);
    }
  }
  static stringify(value: UntrustedYamlNode): string {
    try {
      return `${Bun.YAML.stringify(value).trimEnd()}\n`;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const loomFailureDetailArgs: LoomFailureDetailArgs = {
        code: LoomFailureCode.YamlStringifyFailed,
        text: message,
      };
      LoomFailure.detail(loomFailureDetailArgs);
    }
  }
}

export type YamlParseSuccess = {
  readonly value: UntrustedYamlNode;
  readonly text: string;
};
