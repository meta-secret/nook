import { readFileSync } from 'node:fs';
import { asUntrustedYamlNode, type UntrustedYamlNode } from '../lib/guards.ts';
import { LoomFailureCode, loomFailureDetail } from '../loom-failure.ts';
import {
  FieldIssue,
  decodeErr,
  decodeOk,
  fieldDetailText,
  fieldError,
  type DecodeOutcome,
} from './field-error.ts';

import type { FieldErrorArgs } from './field-error.ts';
import type { LoomFailureDetailArgs } from '../loom-failure.ts';
export type YamlParseSuccess = {
  readonly value: UntrustedYamlNode;
  readonly text: string;
};

export function parseYamlFile(
  filePath: string,
): DecodeOutcome<YamlParseSuccess> {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const fieldErrorArgs2: FieldErrorArgs = {
      path: '',
      issue: FieldIssue.RequestFileReadFailed,
      detail: fieldDetailText(message),
    };
    return decodeErr([fieldError(fieldErrorArgs2)]);
  }
  return parseYamlText(text);
}

export function parseYamlText(text: string): DecodeOutcome<YamlParseSuccess> {
  try {
    const decodeOkArgs = {
      value: asUntrustedYamlNode(Bun.YAML.parse(text) as UntrustedYamlNode),
      text,
    };
    return decodeOk(decodeOkArgs);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const fieldErrorArgs: FieldErrorArgs = {
      path: '',
      issue: FieldIssue.InvalidYaml,
      detail: fieldDetailText(message),
    };
    return decodeErr([fieldError(fieldErrorArgs)]);
  }
}

export function stringifyYaml(value: UntrustedYamlNode): string {
  try {
    return `${Bun.YAML.stringify(value).trimEnd()}\n`;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const loomFailureDetailArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.YamlStringifyFailed,
      text: message,
    };
    loomFailureDetail(loomFailureDetailArgs);
  }
}
