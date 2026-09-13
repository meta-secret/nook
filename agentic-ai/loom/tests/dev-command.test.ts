import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

import { ProcessCommandRunner } from '../src/dev-delivery/dev-command.ts';
import { CommandExecutable } from '../src/dev-delivery/dev-types.ts';

const SHA = '1111111111111111111111111111111111111111';

test('isolates Git delivery and pins its remote without exposing the token', () => {
  const root = mkdtempSync(join(tmpdir(), 'nook-dev-command-'));
  const bin = join(root, 'bin');
  const capture = join(root, 'capture');
  const fakeGit = join(bin, 'git');
  const previousPath = process.env.PATH;
  const previousToken = process.env.NOOK_GITHUB_PAT;
  const previousCapture = process.env.NOOK_DEV_COMMAND_CAPTURE;
  const previousConfig = process.env.GIT_CONFIG_PARAMETERS;
  try {
    mkdirSync(bin);
    writeFileSync(
      fakeGit,
      `#!/bin/sh
{
  printf 'config=%s\\n' "$GIT_CONFIG"
  printf 'global=%s\\n' "$GIT_CONFIG_GLOBAL"
  printf 'system=%s\\n' "$GIT_CONFIG_SYSTEM"
  printf 'noSystem=%s\\n' "$GIT_CONFIG_NOSYSTEM"
  printf 'replace=%s\\n' "$GIT_NO_REPLACE_OBJECTS"
  printf 'prompt=%s\\n' "$GIT_TERMINAL_PROMPT"
  printf 'ambientConfig=%s\\n' "$GIT_CONFIG_PARAMETERS"
  printf 'pat=%s\\n' "$NOOK_GITHUB_PAT"
  printf 'headerPresent=%s\\n' "$([ -n "$NOOK_GIT_EXTRAHEADER" ] && echo yes || echo no)"
  printf 'args='
  printf '%s ' "$@"
  printf '\\n'
} >> "$NOOK_DEV_COMMAND_CAPTURE"
exit 0
`,
    );
    chmodSync(fakeGit, 0o755);
    process.env.PATH = `${bin}:${previousPath ?? '/usr/bin:/bin'}`;
    process.env.NOOK_DEV_COMMAND_CAPTURE = capture;
    process.env.NOOK_GITHUB_PAT = 'delivery-secret';
    process.env.GIT_CONFIG_PARAMETERS = 'hostile-config';

    const result = new ProcessCommandRunner().run({
      executable: CommandExecutable.Git,
      args: ['push', 'origin', `${SHA}:refs/heads/dev`],
      workingDirectory: root,
    });

    expect(result.isOk()).toBe(true);
    const output = readFileSync(capture, 'utf8');
    expect(output).toContain('config=/dev/null');
    expect(output).toContain('global=/dev/null');
    expect(output).toContain('system=/dev/null');
    expect(output).toContain('noSystem=1');
    expect(output).toContain('replace=1');
    expect(output).toContain('prompt=0');
    expect(output).toContain('ambientConfig=\n');
    expect(output).toContain('pat=\n');
    expect(output).toContain('headerPresent=yes');
    expect(output).toContain('https://github.com/meta-secret/nook.git');
    expect(output).toContain('--no-verify');
    expect(output).toContain('--no-replace-objects');
    expect(output).toContain(
      '--config-env=http.https://github.com/.extraheader=NOOK_GIT_EXTRAHEADER',
    );
    expect(output).toContain(`${SHA}:refs/heads/dev`);
    expect(output).not.toContain('delivery-secret');
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousToken === undefined) delete process.env.NOOK_GITHUB_PAT;
    else process.env.NOOK_GITHUB_PAT = previousToken;
    if (previousCapture === undefined)
      delete process.env.NOOK_DEV_COMMAND_CAPTURE;
    else process.env.NOOK_DEV_COMMAND_CAPTURE = previousCapture;
    if (previousConfig === undefined) delete process.env.GIT_CONFIG_PARAMETERS;
    else process.env.GIT_CONFIG_PARAMETERS = previousConfig;
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses a repository-local URL rewrite before remote Git execution', () => {
  const root = mkdtempSync(join(tmpdir(), 'nook-dev-command-unsafe-'));
  const bin = join(root, 'bin');
  const capture = join(root, 'capture');
  const fakeGit = join(bin, 'git');
  const previousPath = process.env.PATH;
  const previousCapture = process.env.NOOK_DEV_COMMAND_CAPTURE;
  try {
    mkdirSync(bin);
    writeFileSync(
      fakeGit,
      `#!/bin/sh
printf 'invoked\\n' >> "$NOOK_DEV_COMMAND_CAPTURE"
for argument in "$@"; do
  if [ "$argument" = config ]; then
    printf 'url.https://evil.example/.insteadOf\\n'
    exit 0
  fi
done
exit 0
`,
    );
    chmodSync(fakeGit, 0o755);
    process.env.PATH = `${bin}:${previousPath ?? '/usr/bin:/bin'}`;
    process.env.NOOK_DEV_COMMAND_CAPTURE = capture;

    const result = new ProcessCommandRunner().run({
      executable: CommandExecutable.Git,
      args: ['ls-remote', '--refs', 'origin', 'refs/heads/main'],
      workingDirectory: root,
    });

    expect(result.isErr()).toBe(true);
    expect(readFileSync(capture, 'utf8')).toBe('invoked\n');
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousCapture === undefined)
      delete process.env.NOOK_DEV_COMMAND_CAPTURE;
    else process.env.NOOK_DEV_COMMAND_CAPTURE = previousCapture;
    rmSync(root, { recursive: true, force: true });
  }
});
