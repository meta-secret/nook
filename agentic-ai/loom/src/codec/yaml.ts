import { readFileSync } from 'node:fs';
import { asExternalValue, type ExternalValue } from '../lib/guards.ts';
import { LoomFailureCode, loomFailureDetail } from '../loom-failure.ts';
import {
  FieldIssue,
  decodeErr,
  decodeOk,
  fieldDetailText,
  fieldError,
  type DecodeOutcome,
} from './field-error.ts';

export type YamlParseSuccess = {
  readonly value: ExternalValue;
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
    return decodeErr([
      fieldError({
        path: '',
        issue: FieldIssue.RequestFileReadFailed,
        detail: fieldDetailText(message),
      }),
    ]);
  }
  return parseYamlText(text);
}

export function parseYamlText(text: string): DecodeOutcome<YamlParseSuccess> {
  try {
    return decodeOk({
      value: asExternalValue(Bun.YAML.parse(text) as ExternalValue),
      text,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return decodeErr([
      fieldError({
        path: '',
        issue: FieldIssue.InvalidYaml,
        detail: fieldDetailText(message),
      }),
    ]);
  }
}

export function stringifyYaml(value: ExternalValue): string {
  try {
    return `${Bun.YAML.stringify(value).trimEnd()}\n`;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    loomFailureDetail({
      code: LoomFailureCode.YamlStringifyFailed,
      text: message,
    });
  }
}
