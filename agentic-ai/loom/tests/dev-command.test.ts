import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

import { ProcessCommandRunner } from '../src/dev-delivery/dev-command.ts';
import { CommandExecutable } from '../src/dev-delivery/dev-types.ts';

const SHA = '1111111111111111111111111111111111111111';

class GitFixture {
  static initialize(
    ...[root, remote = 'https://github.com/meta-secret/nook.git']: [
      root: string,
      remote?: string,
    ]
  ): void {
    execFileSync('git', ['-C', root, 'init', '-q']);
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Nook Fixture']);
    execFileSync('git', [
      '-C',
      root,
      'config',
      'user.email',
      'nook-fixture@example.test',
    ]);
    execFileSync('git', ['-C', root, 'config', 'remote.origin.url', remote]);
  }

  static commit(
    ...[root, path, content, message]: [
      root: string,
      path: string,
      content: string,
      message: string,
    ]
  ): string {
    writeFileSync(join(root, path), content);
    execFileSync('git', ['-C', root, 'add', '--', path]);
    execFileSync('git', ['-C', root, 'commit', '-qm', message]);
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  }
}

test('isolates Git delivery and pins its remote without exposing the token', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nook-dev-command-')));
  const bin = join(root, 'bin');
  const capture = join(root, 'capture');
  const fakeGit = join(bin, 'git');
  const previousPath = process.env.PATH;
  const previousToken = process.env.NOOK_GITHUB_PAT;
  const previousCapture = process.env.NOOK_DEV_COMMAND_CAPTURE;
  const previousConfig = process.env.GIT_CONFIG_PARAMETERS;
  try {
    mkdirSync(bin);
    GitFixture.initialize(root);
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
} >> ${JSON.stringify(capture)}
exit 0
`,
    );
    chmodSync(fakeGit, 0o755);
    process.env.PATH = `${bin}:${previousPath || '/usr/bin:/bin'}`;
    process.env.NOOK_DEV_COMMAND_CAPTURE = capture;
    process.env.NOOK_GITHUB_PAT = 'delivery-secret';
    process.env.GIT_CONFIG_PARAMETERS = 'hostile-config';

    const result = new ProcessCommandRunner({ repositoryRoot: root }).run({
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
    expect(output).toContain('http.saveCookies=false');
    expect(output).toContain('http.sslVerify=true');
    expect(output).toContain('protocol.https.allow=always');
    expect(output).toContain(
      '--config-env=http.https://github.com/.extraheader=NOOK_GIT_EXTRAHEADER',
    );
    expect(output).not.toContain('credential.helper=');
    expect(output).not.toContain('http.cookieFile=');
    expect(output).not.toContain('http.sslCAInfo=');
    expect(output).not.toContain('http.sslCAPath=');
    expect(output).not.toContain('http.sslCert=');
    expect(output).not.toContain('http.sslKey=');
    expect(output).toContain(`${SHA}:refs/heads/dev`);
    expect(output).not.toContain('delivery-secret');
  } finally {
    if (typeof previousPath !== 'string') delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (typeof previousToken !== 'string') delete process.env.NOOK_GITHUB_PAT;
    else process.env.NOOK_GITHUB_PAT = previousToken;
    if (typeof previousCapture !== 'string')
      delete process.env.NOOK_DEV_COMMAND_CAPTURE;
    else process.env.NOOK_DEV_COMMAND_CAPTURE = previousCapture;
    if (typeof previousConfig !== 'string')
      delete process.env.GIT_CONFIG_PARAMETERS;
    else process.env.GIT_CONFIG_PARAMETERS = previousConfig;
    rmSync(root, { recursive: true, force: true });
  }
});

test('ignores unsafe local and worktree config during remote Git execution', () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'nook-dev-command-unsafe-')),
  );
  const bin = join(root, 'bin');
  const capture = join(root, 'capture');
  const fakeGit = join(bin, 'git');
  const previousPath = process.env.PATH;
  const previousCapture = process.env.NOOK_DEV_COMMAND_CAPTURE;
  const previousToken = process.env.NOOK_GITHUB_PAT;
  try {
    mkdirSync(bin);
    GitFixture.initialize(root);
    execFileSync('git', [
      '-C',
      root,
      'config',
      'extensions.worktreeConfig',
      'true',
    ]);
    execFileSync('git', [
      '-C',
      root,
      'config',
      'url.https://evil.example/.insteadOf',
      'https://github.com/',
    ]);
    execFileSync('git', ['-C', root, 'config', 'http.sslVerify', 'false']);
    execFileSync('git', [
      '-C',
      root,
      'config',
      'http.sslCAInfo',
      '/tmp/evil-ca',
    ]);
    execFileSync('git', [
      '-C',
      root,
      'config',
      'http.cookieFile',
      '/tmp/evil-cookie',
    ]);
    execFileSync('git', [
      '-C',
      root,
      'config',
      'credential.helper',
      '/tmp/evil-helper',
    ]);
    execFileSync('git', [
      '-C',
      root,
      'config',
      '--worktree',
      'http.proxy',
      'http://evil-proxy.invalid',
    ]);
    writeFileSync(
      fakeGit,
      `#!/bin/sh
{
  printf 'invoked\\n'
  printf 'gitDir=%s\\n' "$GIT_DIR"
  printf 'workTree=%s\\n' "$GIT_WORK_TREE"
  printf 'args=%s\\n' "$*"
} >> ${JSON.stringify(capture)}
exit 0
`,
    );
    chmodSync(fakeGit, 0o755);
    process.env.PATH = `${bin}:${previousPath || '/usr/bin:/bin'}`;
    process.env.NOOK_DEV_COMMAND_CAPTURE = capture;

    for (const token of [false, ''] as const) {
      if (token === false) delete process.env.NOOK_GITHUB_PAT;
      else process.env.NOOK_GITHUB_PAT = token;
      const result = new ProcessCommandRunner({ repositoryRoot: root }).run({
        executable: CommandExecutable.Git,
        args: ['ls-remote', '--refs', 'origin', 'refs/heads/main'],
        workingDirectory: root,
      });
      expect(result.isOk()).toBe(true);
    }

    const output = readFileSync(capture, 'utf8');
    expect(output).toContain('invoked\n');
    expect(output).toContain('gitDir=');
    expect(output).toContain('workTree=' + root);
    expect(output).toContain('http.saveCookies=false');
    expect(output).toContain('http.sslVerify=true');
    expect(output).toContain('protocol.file.allow=never');
    expect(output).toContain('protocol.https.allow=always');
    expect(output).not.toContain('credential.helper=');
    expect(output).toContain(
      'credential.https://github.com.helper=!gh auth git-credential',
    );
    expect(output).not.toContain('http.cookieFile=');
    expect(output).not.toContain('http.sslCAInfo=');
    expect(output).not.toContain('http.sslCAPath=');
    expect(output).not.toContain('http.sslCert=');
    expect(output).not.toContain('http.sslKey=');
    expect(output).not.toContain('evil.example');
    expect(output).not.toContain('evil-ca');
    expect(output).not.toContain('evil-cookie');
  } finally {
    if (typeof previousPath !== 'string') delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (typeof previousCapture !== 'string')
      delete process.env.NOOK_DEV_COMMAND_CAPTURE;
    else process.env.NOOK_DEV_COMMAND_CAPTURE = previousCapture;
    if (typeof previousToken !== 'string') delete process.env.NOOK_GITHUB_PAT;
    else process.env.NOOK_GITHUB_PAT = previousToken;
    rmSync(root, { recursive: true, force: true });
  }
});

test('local merge and merge-tree cannot execute repository merge drivers or hooks', () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'nook-dev-command-merge-')),
  );
  const marker = join(root, 'executed');
  const driver = join(root, 'merge-driver.sh');
  try {
    GitFixture.initialize(root);
    execFileSync('git', ['-C', root, 'branch', '-M', 'main']);
    GitFixture.commit(
      root,
      '.gitattributes',
      '*.txt merge=evil\n',
      'attributes',
    );
    GitFixture.commit(root, 'file.txt', 'base\n', 'base');
    execFileSync('git', ['-C', root, 'switch', '-qc', 'feature']);
    GitFixture.commit(root, 'file.txt', 'feature\n', 'feature');
    execFileSync('git', ['-C', root, 'switch', '-q', 'main']);
    GitFixture.commit(root, 'file.txt', 'main\n', 'main');
    writeFileSync(
      driver,
      `#!/bin/sh
printf 'merge-driver\\n' >> "${marker}"
cp "$2" "$1"
`,
    );
    chmodSync(driver, 0o755);
    execFileSync('git', [
      '-C',
      root,
      'config',
      'merge.evil.driver',
      `${driver} %O %A %B`,
    ]);
    const hook = join(root, '.git', 'hooks', 'pre-merge-commit');
    writeFileSync(hook, `printf 'hook\\n' >> "${marker}"\n`);
    chmodSync(hook, 0o755);

    const runner = new ProcessCommandRunner({ repositoryRoot: root });
    const preview = runner.run({
      executable: CommandExecutable.Git,
      args: [
        'merge-tree',
        '--write-tree',
        execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
          encoding: 'utf8',
        }).trim(),
        execFileSync('git', ['-C', root, 'rev-parse', 'feature'], {
          encoding: 'utf8',
        }).trim(),
      ],
      workingDirectory: root,
    });
    expect(preview.isOk()).toBe(true);
    const merge = runner.run({
      executable: CommandExecutable.Git,
      args: ['merge', '--no-edit', 'feature'],
      workingDirectory: root,
    });
    expect(merge.isOk()).toBe(true);
    expect(existsSync(marker)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not treat absent merge metadata as an in-progress merge', () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'nook-dev-command-merge-state-')),
  );
  try {
    GitFixture.initialize(root);
    execFileSync('git', ['-C', root, 'branch', '-M', 'dev']);
    GitFixture.commit(root, 'file.txt', 'base', 'base');
    execFileSync('git', ['-C', root, 'switch', '-qc', 'feature']);
    GitFixture.commit(root, 'file.txt', 'feature', 'feature');
    execFileSync('git', ['-C', root, 'switch', '-q', 'dev']);

    const result = new ProcessCommandRunner({ repositoryRoot: root }).run({
      executable: CommandExecutable.Git,
      args: ['merge', '--ff-only', 'feature'],
      workingDirectory: root,
    });

    expect(result.isOk()).toBe(true);
    expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe('feature');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fetch preserves explicit refspecs and adds only the managed default refspec', () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'nook-dev-command-fetch-')),
  );
  const bin = join(root, 'bin');
  const capture = join(root, 'capture');
  const fakeGit = join(bin, 'git');
  const previousPath = process.env.PATH;
  const previousCapture = process.env.NOOK_DEV_COMMAND_CAPTURE;
  try {
    mkdirSync(bin);
    GitFixture.initialize(root);
    writeFileSync(
      fakeGit,
      `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(capture)}
exit 0
`,
    );
    chmodSync(fakeGit, 0o755);
    process.env.PATH = `${bin}:${previousPath || '/usr/bin:/bin'}`;
    process.env.NOOK_DEV_COMMAND_CAPTURE = capture;
    const runner = new ProcessCommandRunner({ repositoryRoot: root });
    expect(
      runner
        .run({
          executable: CommandExecutable.Git,
          args: ['fetch', '--quiet', 'origin'],
          workingDirectory: root,
        })
        .isOk(),
    ).toBe(true);
    expect(
      runner
        .run({
          executable: CommandExecutable.Git,
          args: [
            'fetch',
            '--quiet',
            'origin',
            'refs/heads/main:refs/remotes/origin/main',
          ],
          workingDirectory: root,
        })
        .isOk(),
    ).toBe(true);
    const output = readFileSync(capture, 'utf8');
    expect(output).toContain('+refs/heads/*:refs/remotes/origin/*');
    expect(output).toContain('refs/heads/main:refs/remotes/origin/main');
    expect(
      output.match(/\+refs\/heads\/\*:refs\/remotes\/origin\/\*/g)?.length,
    ).toBe(1);
  } finally {
    if (typeof previousPath !== 'string') delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (typeof previousCapture !== 'string')
      delete process.env.NOOK_DEV_COMMAND_CAPTURE;
    else process.env.NOOK_DEV_COMMAND_CAPTURE = previousCapture;
    rmSync(root, { recursive: true, force: true });
  }
});

test('remote Git fails closed when the root, common directory, or origin identity mismatches', () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'nook-dev-command-binding-')),
  );
  const canonical = join(root, 'canonical');
  const other = join(root, 'other');
  const alias = join(root, 'alias');
  mkdirSync(canonical);
  mkdirSync(other);
  try {
    GitFixture.initialize(canonical);
    GitFixture.initialize(other);
    symlinkSync(other, alias);
    const runner = new ProcessCommandRunner({ repositoryRoot: canonical });
    const mismatch = runner.run({
      executable: CommandExecutable.Git,
      args: ['push', 'origin', `${SHA}:refs/heads/dev`],
      workingDirectory: other,
    });
    expect(mismatch.isErr()).toBe(true);
    const aliasMismatch = runner.run({
      executable: CommandExecutable.Git,
      args: ['push', 'origin', `${SHA}:refs/heads/dev`],
      workingDirectory: alias,
    });
    expect(aliasMismatch.isErr()).toBe(true);
    const evilRoot = join(root, 'evil');
    mkdirSync(evilRoot);
    GitFixture.initialize(evilRoot, 'https://evil.example/nook.git');
    const evil = new ProcessCommandRunner({ repositoryRoot: evilRoot }).run({
      executable: CommandExecutable.Git,
      args: ['push', 'origin', `${SHA}:refs/heads/dev`],
      workingDirectory: evilRoot,
    });
    expect(evil.isErr()).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
