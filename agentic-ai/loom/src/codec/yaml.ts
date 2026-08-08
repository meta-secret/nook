import { readFileSync } from 'node:fs';
import { ResultKind, err, ok, type Result } from '../result.ts';
import { decodeErr, fieldError, type DecodeResult } from './field-error.ts';

export function parseYamlFile(filePath: string): DecodeResult<unknown> {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return decodeErr([
      fieldError('', `failed to read request file: ${message}`),
    ]);
  }
  try {
    return { kind: ResultKind.Ok, value: Bun.YAML.parse(text) };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return decodeErr([fieldError('', `invalid YAML: ${message}`)]);
  }
}

export function stringifyYaml(value: unknown): Result<string> {
  try {
    return ok(`${Bun.YAML.stringify(value).trimEnd()}\n`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err(`failed to stringify YAML: ${message}`);
  }
}
