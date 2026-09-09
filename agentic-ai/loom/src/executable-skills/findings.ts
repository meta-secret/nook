import type { ExecutableSkillPackageFinding } from './repository.ts';
import {
  EXECUTABLE_SKILL_FINDING_LIMIT,
  EXECUTABLE_SKILL_DIAGNOSTIC_BYTE_LIMIT,
} from './repository.ts';
const FINDING_PATH_LIMIT = 512;
const FINDING_ISSUE_LIMIT = 512;
export type ExecutableSkillFindingPathRequest = {
  readonly candidate: string;
  readonly fallback: string;
};
export class ExecutableSkillFindingPath {
  private constructor(private readonly candidate: string) {}
  static safe(request: ExecutableSkillFindingPathRequest): string {
    return new ExecutableSkillFindingPath(request.candidate).bounded(
      request.fallback,
    );
  }
  private bounded(fallback: string): string {
    return ExecutableSkillFindingPath.dangerousPath(this.candidate) ||
      this.candidate.length > FINDING_PATH_LIMIT
      ? fallback
      : this.candidate;
  }
  static dangerousPath(candidate: string): boolean {
    for (const character of candidate) {
      const [codePoint = 0] = [character.codePointAt(0)];
      if (
        character === ':' ||
        character === '\\' ||
        codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x061c ||
        codePoint === 0x200e ||
        codePoint === 0x200f ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x206f)
      )
        return true;
    }
    return false;
  }
}
export class ExecutableSkillFindingCollector {
  readonly findings: ExecutableSkillPackageFinding[] = [];
  private bytes = 0;
  add(request: ExecutableSkillPackageFinding): void {
    if (this.findings.length >= EXECUTABLE_SKILL_FINDING_LIMIT) return;
    const findingPath = ExecutableSkillFindingPath.safe({
      candidate: request.path,
      fallback: '.cortex',
    });
    const boundedIssue = request.issue.slice(0, FINDING_ISSUE_LIMIT);
    const bytes =
      Buffer.byteLength(findingPath) + Buffer.byteLength(boundedIssue);
    if (this.bytes + bytes > EXECUTABLE_SKILL_DIAGNOSTIC_BYTE_LIMIT) return;
    this.findings.push({ path: findingPath, issue: boundedIssue });
    this.bytes += bytes;
  }
}
