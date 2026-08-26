import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const DOCKER_EXECUTABLE_CANDIDATES = [
  '/usr/bin/docker',
  '/usr/local/bin/docker',
  '/opt/homebrew/bin/docker',
  '/Applications/Docker.app/Contents/Resources/bin/docker',
] as const;

const TRUSTED_DOCKER_EXECUTABLE_ROOTS = [
  '/usr/bin',
  '/Applications/Docker.app/Contents/Resources/bin',
] as const;

export async function resolveTrustedDockerExecutable(): Promise<string> {
  for (const candidate of DOCKER_EXECUTABLE_CANDIDATES) {
    const executable = await inspectDockerExecutable(candidate);
    if (executable !== false) return executable;
  }
  throw new Error('A trusted absolute Docker executable is required.');
}

async function inspectDockerExecutable(
  candidate: string,
): Promise<string | false> {
  try {
    const executable = await realpath(candidate);
    if (!isTrustedDockerExecutablePath(executable)) return false;
    const metadata = await stat(executable);
    if (
      !metadata.isFile() ||
      metadata.uid !== 0 ||
      (metadata.mode & 0o022) !== 0
    ) {
      return false;
    }
    await access(executable, constants.X_OK);
    return executable;
  } catch {
    return false;
  }
}

function isTrustedDockerExecutablePath(executable: string): boolean {
  if (
    !path.isAbsolute(executable) ||
    path.normalize(executable) !== executable
  ) {
    return false;
  }
  return TRUSTED_DOCKER_EXECUTABLE_ROOTS.some((root) => {
    const relative = path.relative(root, executable);
    return (
      relative.length > 0 &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative)
    );
  });
}
