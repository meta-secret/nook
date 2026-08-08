import { existsSync } from 'node:fs';
import path from 'node:path';

export type BrokenLink = {
  readonly file: string;
  readonly line: number;
  readonly target: string;
};

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

export type FindBrokenRelativeLinksArgs = {
  readonly filePath: string;
  readonly content: string;
  readonly repoRoot: string;
};

export function findBrokenRelativeLinks(
  args: FindBrokenRelativeLinksArgs,
): BrokenLink[] {
  const { filePath, content, repoRoot } = args;

  const broken: BrokenLink[] = [];
  const lines = content.split(/\r?\n/);
  const fileDir = path.dirname(filePath);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    LINK_RE.lastIndex = 0;
    for (;;) {
      const match = LINK_RE.exec(line);
      if (!match) {
        break;
      }
      const target = typeof match[2] === 'string' ? match[2] : '';
      if (shouldCheckLink(target)) {
        const hashParts = target.split('#');
        const withoutHash =
          typeof hashParts[0] === 'string' ? hashParts[0] : '';
        if (withoutHash.length > 0) {
          const resolved = path.resolve(fileDir, withoutHash);
          if (!existsSync(resolved)) {
            broken.push({
              file: path.relative(repoRoot, filePath),
              line: i + 1,
              target,
            });
          }
        }
      }
    }
  }

  return broken;
}

function shouldCheckLink(target: string): boolean {
  if (target.length === 0) {
    return false;
  }
  if (target.startsWith('http://') || target.startsWith('https://')) {
    return false;
  }
  if (target.startsWith('mailto:')) {
    return false;
  }
  if (target.startsWith('#')) {
    return false;
  }
  return true;
}
