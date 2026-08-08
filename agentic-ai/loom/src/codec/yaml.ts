import { readFileSync } from 'node:fs';
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
  readonly value: unknown;
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
      fieldError(
        '',
        FieldIssue.RequestFileReadFailed,
        fieldDetailText(message),
      ),
    ]);
  }
  return parseYamlText(text);
}

export function parseYamlText(text: string): DecodeOutcome<YamlParseSuccess> {
  try {
    return decodeOk({ value: Bun.YAML.parse(text), text });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return decodeErr([
      fieldError('', FieldIssue.InvalidYaml, fieldDetailText(message)),
    ]);
  }
}

export function stringifyYaml(value: unknown): string {
  try {
    return `${Bun.YAML.stringify(value).trimEnd()}\n`;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    loomFailureDetail(LoomFailureCode.YamlStringifyFailed, message);
  }
}
