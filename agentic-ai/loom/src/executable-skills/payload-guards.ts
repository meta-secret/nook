import { createHash } from 'node:crypto';
import { ExecutableSkillPayloadKind } from './domain.ts';

export type AssertExecutableSkillByteLimitRequest = {
  readonly value: string;
  readonly maximumBytes: number;
  readonly label: ExecutableSkillPayloadKind;
};

export function assertExecutableSkillByteLimit(
  request: AssertExecutableSkillByteLimitRequest,
): void {
  if (Buffer.byteLength(request.value, 'utf8') > request.maximumBytes) {
    throw new Error(
      `Executable skill ${request.label} exceeds its byte limit.`,
    );
  }
}

export function boundedExecutableSkillStderr(stderr: string): string {
  const normalized = stderr.trim().replaceAll(/[\r\n]+/gu, ' ');
  return normalized.slice(0, 512) || 'runner exited without an error message';
}

export function executableSkillSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
