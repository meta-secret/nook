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

export function parseYamlFile(filePath: string): DecodeOutcome<unknown> {
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
  try {
    return decodeOk(Bun.YAML.parse(text));
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

export function stringifyYamlOrThrow(value: unknown): string {
  return stringifyYaml(value);
}
