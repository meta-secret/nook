import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { err, ok, type Result } from 'neverthrow';

import {
  CommandExecutable,
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
  DevFailureKind,
  type DevFailure,
} from './dev-types.ts';

type RepositoryMetadata = {
  readonly root: string;
  readonly commonDirectory: string;
  readonly gitDirectory: string;
  readonly workingGitDirectory: string;
};

type IsolatedGitDirectory = {
  readonly path: string;
  readonly cleanup: () => void;
};

type RemoteIdentityConfig = {
  readonly identities: readonly string[];
  readonly hasOriginUrl: boolean;
};

/** Owns the bounded host-process boundary for the dev delivery commands. */
export class ProcessCommandRunner implements CommandRunner {
  private readonly repositoryRoot?: string;

  private static readonly maxOutputBytes = 16 * 1024 * 1024;

  private static readonly canonicalRemoteUrl =
    'https://github.com/meta-secret/nook.git';

  private static readonly canonicalRemoteIdentity = 'meta-secret/nook';

  private static readonly gitOptions = [
    '-c',
    'commit.gpgSign=false',
    '-c',
    'core.attributesFile=/dev/null',
    '-c',
    'core.askPass=',
    '-c',
    'core.excludesFile=/dev/null',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.gitProxy=none',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.sshCommand=',
    '-c',
    'core.untrackedCache=false',
    '-c',
    'tag.gpgSign=false',
    '-c',
    'filter.lfs.clean=',
    '-c',
    'filter.lfs.process=',
    '-c',
    'filter.lfs.required=false',
    '-c',
    'filter.lfs.smudge=',
    '-c',
    'http.proxy=',
    '-c',
    'http.noProxy=',
    '-c',
    'https.proxy=',
    '-c',
    'https.noProxy=',
    '--no-pager',
    '--no-replace-objects',
    '--literal-pathspecs',
  ] as const;

  private static readonly remoteGitOptions = [
    ...ProcessCommandRunner.gitOptions,
    '-c',
    'http.saveCookies=false',
    '-c',
    'http.sslVerify=true',
    '-c',
    'http.proxy=',
    '-c',
    'https.proxy=',
    '-c',
    'protocol.allow=never',
    '-c',
    'protocol.ext.allow=never',
    '-c',
    'protocol.file.allow=never',
    '-c',
    'protocol.ftp.allow=never',
    '-c',
    'protocol.ftps.allow=never',
    '-c',
    'protocol.git.allow=never',
    '-c',
    'protocol.http.allow=never',
    '-c',
    'protocol.ssh.allow=never',
    '-c',
    'protocol.https.allow=always',
  ] as const;

  constructor(request: { readonly repositoryRoot?: string } = {}) {
    if (typeof request.repositoryRoot === 'string')
      this.repositoryRoot = request.repositoryRoot;
  }

  run(request: CommandRequest): Result<CommandOutput, DevFailure> {
    const git = request.executable === CommandExecutable.Git;
    const remoteOperation =
      git && ProcessCommandRunner.isRemoteOperation(request.args);
    const isolatedOperation =
      git &&
      (remoteOperation ||
        ProcessCommandRunner.requiresIsolatedRepository(request.args));
    const repository = remoteOperation
      ? this.bindRepository(request)
      : isolatedOperation
        ? ProcessCommandRunner.inspectRepository(request.workingDirectory)
        : ok<RepositoryMetadata | false, DevFailure>(false);
    if (repository.isErr()) return err(repository.error);
    const argsResult = git
      ? ProcessCommandRunner.gitArguments(request.args, remoteOperation)
      : ok<readonly string[], DevFailure>([...request.args]);
    if (argsResult.isErr()) return err(argsResult.error);
    const args = argsResult.value;
    let isolatedGitDirectory: IsolatedGitDirectory | false = false;
    try {
      if (isolatedOperation) {
        const metadata = repository.value;
        if (metadata === false)
          return err({
            kind: DevFailureKind.Configuration,
            message: 'Git delivery could not bind its repository metadata',
          });
        const isolated = ProcessCommandRunner.createIsolatedGitDirectory(
          metadata,
          request.workingDirectory,
          remoteOperation,
        );
        if (isolated.isErr()) return err(isolated.error);
        isolatedGitDirectory = isolated.value;
      }
      const isolatedPath =
        isolatedGitDirectory === false ? '' : isolatedGitDirectory.path;
      const execution = spawnSync(request.executable, args, {
        cwd: request.workingDirectory,
        encoding: 'utf8',
        env: git
          ? ProcessCommandRunner.gitEnvironment(
              remoteOperation,
              request.workingDirectory,
              isolatedPath,
            )
          : {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0',
              LC_ALL: 'C',
            },
        maxBuffer: ProcessCommandRunner.maxOutputBytes,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout = ProcessCommandRunner.text(execution.stdout);
      const stderr = ProcessCommandRunner.text(execution.stderr);
      const exitCode =
        typeof execution.status === 'number' ? execution.status : 1;
      if (execution.error) {
        return err({
          kind: DevFailureKind.Command,
          message: `${request.executable} could not start: ${execution.error.message}`,
        });
      }
      return ok({ exitCode, stdout, stderr });
    } catch {
      return err({
        kind: DevFailureKind.Command,
        message: `${request.executable} command invocation failed`,
      });
    } finally {
      if (isolatedGitDirectory !== false) isolatedGitDirectory.cleanup();
    }
  }

  private static isRemoteOperation(args: readonly string[]): boolean {
    const command = args.at(0);
    return command === 'fetch' || command === 'ls-remote' || command === 'push';
  }

  private static gitArguments(
    ...[requestArgs, remoteOperation]: [
      requestArgs: readonly string[],
      remoteOperation: boolean,
    ]
  ): Result<readonly string[], DevFailure> {
    if (!remoteOperation)
      return ok([...ProcessCommandRunner.gitOptions, ...requestArgs]);
    const args = [...requestArgs];
    const remoteIndices = args.flatMap(
      (...[argument, index]: [argument: string, index: number]) =>
        index > 0 &&
        (argument === 'origin' ||
          argument === ProcessCommandRunner.canonicalRemoteUrl)
          ? [index]
          : [],
    );
    const remoteIndex = remoteIndices.at(0);
    if (typeof remoteIndex !== 'number' || remoteIndices.length !== 1)
      return err({
        kind: DevFailureKind.Configuration,
        message: 'Git delivery requires the admitted canonical origin remote',
      });
    args[remoteIndex] = ProcessCommandRunner.canonicalRemoteUrl;
    const command = args.at(0);
    if (command === 'fetch') {
      const hasExplicitRefspec = args
        .slice(remoteIndex + 1)
        .some((argument) => !argument.startsWith('-'));
      if (!hasExplicitRefspec) args.push('+refs/heads/*:refs/remotes/origin/*');
    }
    if (command === 'push' && !args.includes('--no-verify'))
      args.splice(1, 0, '--no-verify');
    const credential = process.env.NOOK_GITHUB_PAT?.trim();
    const credentialOption =
      credential &&
      !credential.includes('\u0000') &&
      !/[\r\n]/u.test(credential)
        ? [
            '--config-env=http.https://github.com/.extraheader=NOOK_GIT_EXTRAHEADER',
          ]
        : [
            '-c',
            'credential.https://github.com.helper=!gh auth git-credential',
          ];
    return ok([
      ...ProcessCommandRunner.remoteGitOptions,
      ...credentialOption,
      ...args,
    ]);
  }

  private static gitEnvironment(
    ...[remoteOperation, workingDirectory, isolatedGitDirectory]: [
      remoteOperation: boolean,
      workingDirectory: string,
      isolatedGitDirectory?: string,
    ]
  ): NodeJS.ProcessEnv {
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const environment: NodeJS.ProcessEnv = {
      COMSPEC: process.env.COMSPEC,
      PATH: process.env.PATH,
      Path: process.env.Path,
      PATHEXT: process.env.PATHEXT,
      SYSTEMROOT: process.env.SYSTEMROOT,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      TMPDIR: process.env.TMPDIR,
      WINDIR: process.env.WINDIR,
      GIT_ALLOW_PROTOCOL: 'https',
      GIT_ATTR_NOSYSTEM: '1',
      GIT_CONFIG: nullDevice,
      GIT_CONFIG_GLOBAL: nullDevice,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: nullDevice,
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_PAGER: '',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
    };
    if (isolatedGitDirectory) {
      environment.GIT_DIR = isolatedGitDirectory;
      environment.GIT_WORK_TREE = workingDirectory;
    }
    if (remoteOperation) {
      const credential = process.env.NOOK_GITHUB_PAT?.trim();
      const hasSafeCredential =
        credential &&
        !credential.includes('\u0000') &&
        !/[\r\n]/u.test(credential);
      if (hasSafeCredential) {
        environment.NOOK_GIT_EXTRAHEADER = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${credential}`).toString('base64')}`;
      } else {
        const ghConfigDir = process.env.GH_CONFIG_DIR?.trim();
        if (
          ghConfigDir &&
          !ghConfigDir.includes('\u0000') &&
          !/[\r\n]/u.test(ghConfigDir)
        )
          environment.GH_CONFIG_DIR = ghConfigDir;
      }
    }
    return environment;
  }

  private bindRepository(
    request: CommandRequest,
  ): Result<RepositoryMetadata, DevFailure> {
    const configured =
      request.repositoryRoot || this.repositoryRoot || process.env.REPO_ROOT;
    const root = configured || request.workingDirectory;
    const canonicalRoot = ProcessCommandRunner.canonicalPath(root, 'REPO_ROOT');
    if (canonicalRoot.isErr()) return err(canonicalRoot.error);
    if (configured && !isAbsolute(configured)) {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'REPO_ROOT must be an absolute canonical path',
      });
    }
    for (const candidate of [
      request.repositoryRoot,
      this.repositoryRoot,
      process.env.REPO_ROOT,
    ]) {
      if (typeof candidate !== 'string') continue;
      const canonicalCandidate = ProcessCommandRunner.canonicalPath(
        candidate,
        'REPO_ROOT',
      );
      if (canonicalCandidate.isErr()) return err(canonicalCandidate.error);
      if (canonicalCandidate.value !== canonicalRoot.value) {
        return err({
          kind: DevFailureKind.Race,
          message:
            'Git delivery received conflicting repository-root identities',
        });
      }
    }
    const metadata = ProcessCommandRunner.inspectRepository(
      request.workingDirectory,
      canonicalRoot.value,
    );
    if (metadata.isErr()) return err(metadata.error);
    if (metadata.value.root !== canonicalRoot.value) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `REPO_ROOT is not the Git top-level repository: ${canonicalRoot.value}`,
      });
    }
    const identity = ProcessCommandRunner.repositoryIdentity(metadata.value);
    if (identity.isErr()) return err(identity.error);
    return ok(metadata.value);
  }

  private static requiresIsolatedRepository(args: readonly string[]): boolean {
    const command = args.at(0);
    return command
      ? new Set([
          'checkout',
          'cherry-pick',
          'commit',
          'merge',
          'merge-tree',
          'rebase',
          'reset',
          'revert',
          'symbolic-ref',
          'tag',
          'update-index',
          'update-ref',
        ]).has(command)
      : false;
  }

  private static inspectRepository(
    ...[workingDirectory, expectedRoot]: [
      workingDirectory: string,
      expectedRoot?: string,
    ]
  ): Result<RepositoryMetadata, DevFailure> {
    const canonicalWorkingDirectory = ProcessCommandRunner.canonicalPath(
      workingDirectory,
      'Git working directory',
    );
    if (canonicalWorkingDirectory.isErr())
      return err(canonicalWorkingDirectory.error);
    const working = ProcessCommandRunner.findRepository(
      canonicalWorkingDirectory.value,
    );
    if (working.isErr()) return err(working.error);
    if (expectedRoot) {
      const expected = ProcessCommandRunner.findRepository(expectedRoot);
      if (expected.isErr()) return err(expected.error);
      if (expected.value.root !== expectedRoot) {
        return err({
          kind: DevFailureKind.Configuration,
          message: `REPO_ROOT is not the Git top-level repository: ${expectedRoot}`,
        });
      }
      if (expected.value.commonDirectory !== working.value.commonDirectory) {
        return err({
          kind: DevFailureKind.Race,
          message:
            'Git working directory and REPO_ROOT belong to different repositories',
        });
      }
      return ok({
        ...expected.value,
        workingGitDirectory: working.value.gitDirectory,
      });
    }
    return ok({
      ...working.value,
      workingGitDirectory: working.value.gitDirectory,
    });
  }

  private static findRepository(
    startingDirectory: string,
  ): Result<RepositoryMetadata, DevFailure> {
    let root = startingDirectory;
    while (true) {
      const gitEntry = join(root, '.git');
      if (existsSync(gitEntry)) {
        const entry = ProcessCommandRunner.gitDirectory(gitEntry);
        if (entry.isErr()) return err(entry.error);
        const commonDirectory = ProcessCommandRunner.commonDirectory(
          entry.value,
        );
        if (commonDirectory.isErr()) return err(commonDirectory.error);
        return ok({
          root,
          commonDirectory: commonDirectory.value,
          gitDirectory: entry.value,
          workingGitDirectory: entry.value,
        });
      }
      const parent = dirname(root);
      if (parent === root) break;
      root = parent;
    }
    return err({
      kind: DevFailureKind.Configuration,
      message: `Git working directory is not inside a repository: ${startingDirectory}`,
    });
  }

  private static gitDirectory(gitEntry: string): Result<string, DevFailure> {
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(gitEntry);
    } catch {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Git metadata is unavailable: ${gitEntry}`,
      });
    }
    if (stats.isSymbolicLink()) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Git metadata path must not be a symlink: ${gitEntry}`,
      });
    }
    if (stats.isDirectory()) {
      const canonical = ProcessCommandRunner.canonicalPath(
        gitEntry,
        'Git metadata directory',
      );
      return canonical.isErr() ? err(canonical.error) : ok(canonical.value);
    }
    if (!stats.isFile())
      return err({
        kind: DevFailureKind.Configuration,
        message: `Git metadata path is not a directory or gitfile: ${gitEntry}`,
      });
    let text: string;
    try {
      text = readFileSync(gitEntry, 'utf8');
    } catch {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Git worktree metadata could not be read: ${gitEntry}`,
      });
    }
    const match = /^gitdir:\s*(.+)\s*$/im.exec(text);
    if (!match?.[1])
      return err({
        kind: DevFailureKind.Configuration,
        message: `Git worktree metadata is malformed: ${gitEntry}`,
      });
    const target = isAbsolute(match[1])
      ? match[1]
      : resolve(dirname(gitEntry), match[1]);
    const canonical = ProcessCommandRunner.canonicalPath(
      target,
      'Git worktree metadata directory',
    );
    return canonical.isErr() ? err(canonical.error) : ok(canonical.value);
  }

  private static commonDirectory(
    gitDirectory: string,
  ): Result<string, DevFailure> {
    const commonFile = join(gitDirectory, 'commondir');
    if (!existsSync(commonFile)) return ok(gitDirectory);
    let text: string;
    try {
      text = readFileSync(commonFile, 'utf8').trim();
    } catch {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Git common-directory metadata could not be read: ${commonFile}`,
      });
    }
    if (!text || text.includes('\0'))
      return err({
        kind: DevFailureKind.Configuration,
        message: `Git common-directory metadata is malformed: ${commonFile}`,
      });
    const candidate = isAbsolute(text) ? text : resolve(gitDirectory, text);
    const canonical = ProcessCommandRunner.canonicalPath(
      candidate,
      'Git common directory',
    );
    return canonical.isErr() ? err(canonical.error) : ok(canonical.value);
  }

  private static canonicalPath(
    ...[path, label]: [path: string, label: string]
  ): Result<string, DevFailure> {
    if (!isAbsolute(path) || path.includes('\0'))
      return err({
        kind: DevFailureKind.Configuration,
        message: `${label} must be an absolute path: ${path}`,
      });
    const normalized = resolve(path);
    let canonical: string;
    try {
      canonical = realpathSync(normalized);
    } catch {
      return err({
        kind: DevFailureKind.Configuration,
        message: `${label} must resolve to an existing path: ${path}`,
      });
    }
    if (canonical !== normalized)
      return err({
        kind: DevFailureKind.Configuration,
        message: `${label} must already be canonical: ${path}`,
      });
    return ok(canonical);
  }

  private static repositoryIdentity(
    metadata: RepositoryMetadata,
  ): Result<void, DevFailure> {
    const identities: string[] = [];
    let hasOriginUrl = false;
    for (const configFile of ProcessCommandRunner.configFiles(metadata)) {
      if (!existsSync(configFile)) continue;
      const parsed = ProcessCommandRunner.parseRemoteConfig(configFile);
      if (parsed.isErr()) return err(parsed.error);
      identities.push(...parsed.value.identities);
      hasOriginUrl ||= parsed.value.hasOriginUrl;
    }
    if (
      !hasOriginUrl ||
      identities.length === 0 ||
      identities.some(
        (identity) =>
          ProcessCommandRunner.remoteIdentity(identity) !==
          ProcessCommandRunner.canonicalRemoteIdentity,
      )
    ) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          'REPO_ROOT origin must identify the canonical meta-secret/nook repository',
      });
    }
    return ok();
  }

  private static parseRemoteConfig(
    configFile: string,
  ): Result<RemoteIdentityConfig, DevFailure> {
    let text: string;
    try {
      text = readFileSync(configFile, 'utf8');
    } catch {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Git repository configuration could not be read: ${configFile}`,
      });
    }
    let section = '';
    const identities: string[] = [];
    let hasOriginUrl = false;
    for (const rawLine of text.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
      const line = rawLine.trim();
      const sectionMatch = /^\[remote\s+"([^"]+)"\]$/iu.exec(line);
      if (sectionMatch) {
        section = sectionMatch[1] ? sectionMatch[1].toLowerCase() : '';
        continue;
      }
      if (line.startsWith('[')) {
        section = '';
        continue;
      }
      if (section !== 'origin') continue;
      const valueMatch = /^(url|pushurl)\s*=\s*(.*)$/iu.exec(line);
      if (!valueMatch?.[2]) continue;
      const value = valueMatch[2].trim();
      if (!value || value.includes('\0'))
        return err({
          kind: DevFailureKind.Configuration,
          message: `Git origin identity is malformed in ${configFile}`,
        });
      identities.push(value);
      hasOriginUrl ||= valueMatch[1]?.toLowerCase() === 'url';
    }
    return ok({ identities, hasOriginUrl });
  }

  private static configFiles(metadata: RepositoryMetadata): string[] {
    const files = [join(metadata.commonDirectory, 'config')];
    const worktreeConfig = join(metadata.gitDirectory, 'config.worktree');
    if (worktreeConfig !== files[0]) files.push(worktreeConfig);
    return files;
  }

  private static safeUserConfig(metadata: RepositoryMetadata): string {
    const values = new Map<string, string>();
    for (const configFile of ProcessCommandRunner.configFiles(metadata)) {
      if (!existsSync(configFile)) continue;
      let text: string;
      try {
        text = readFileSync(configFile, 'utf8');
      } catch {
        continue;
      }
      let section = '';
      for (const rawLine of text.split(/\r?\n/u)) {
        const line = rawLine.trim();
        const sectionMatch = /^\[([^\]]+)\]$/u.exec(line);
        if (sectionMatch) {
          section = sectionMatch[1] ? sectionMatch[1].toLowerCase() : '';
          continue;
        }
        const value = /^(name|email)\s*=\s*(.*)$/iu.exec(line);
        if (section !== 'user' || !value?.[2]) continue;
        const key = value[1]?.toLowerCase();
        if (key) values.set(key, value[2].trim());
      }
    }
    const name = values.get('name');
    const email = values.get('email');
    if (
      !name ||
      !email ||
      (name + email).includes('\u0000') ||
      /[\r\n]/u.test(name + email)
    )
      return '';
    const quote = (value: string) =>
      `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    return `[user]\n\tname = ${quote(name)}\n\temail = ${quote(email)}\n`;
  }

  private static remoteIdentity(value: string): string {
    const normalized = value.trim().replace(/\.git$/iu, '');
    if (normalized === 'https://github.com/meta-secret/nook')
      return ProcessCommandRunner.canonicalRemoteIdentity;
    if (normalized === 'ssh://git@github.com/meta-secret/nook')
      return ProcessCommandRunner.canonicalRemoteIdentity;
    if (normalized === 'git@github.com:meta-secret/nook')
      return ProcessCommandRunner.canonicalRemoteIdentity;
    return '';
  }

  private static createIsolatedGitDirectory(
    ...[metadata, workingDirectory, requireCanonicalIdentity = false]: [
      metadata: RepositoryMetadata,
      workingDirectory: string,
      requireCanonicalIdentity?: boolean,
    ]
  ): Result<IsolatedGitDirectory, DevFailure> {
    const refreshed = ProcessCommandRunner.inspectRepository(workingDirectory);
    if (refreshed.isErr()) return err(refreshed.error);
    if (
      refreshed.value.commonDirectory !== metadata.commonDirectory ||
      refreshed.value.gitDirectory !== metadata.workingGitDirectory
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'Git repository metadata changed before the isolated operation began',
      });
    }
    if (requireCanonicalIdentity) {
      const identity = ProcessCommandRunner.repositoryIdentity(metadata);
      if (identity.isErr()) return err(identity.error);
    }
    let path = '';
    try {
      path = mkdtempSync(join(tmpdir(), 'nook-dev-git-'));
      writeFileSync(
        join(path, 'config'),
        `[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tlogallrefupdates = true\n${ProcessCommandRunner.safeUserConfig(metadata)}`,
        'utf8',
      );
      const head = join(metadata.workingGitDirectory, 'HEAD');
      copyFileSync(head, join(path, 'HEAD'));
      ProcessCommandRunner.linkMetadata(
        join(path, 'objects'),
        join(metadata.commonDirectory, 'objects'),
        true,
      );
      ProcessCommandRunner.linkMetadata(
        join(path, 'refs'),
        join(metadata.commonDirectory, 'refs'),
        true,
      );
      ProcessCommandRunner.linkMetadata(
        join(path, 'index'),
        join(metadata.workingGitDirectory, 'index'),
        false,
        true,
      );
      for (const name of [
        'MERGE_HEAD',
        'MERGE_MSG',
        'ORIG_HEAD',
        'SQUASH_MSG',
        'MERGE_RR',
      ]) {
        ProcessCommandRunner.linkMetadata(
          join(path, name),
          join(metadata.workingGitDirectory, name),
          false,
        );
      }
      for (const name of ['logs', 'packed-refs', 'shallow']) {
        ProcessCommandRunner.linkMetadata(
          join(path, name),
          join(metadata.commonDirectory, name),
          false,
        );
      }
      mkdirSync(join(path, 'hooks'));
      const isolatedPath = path;
      return ok({
        path: isolatedPath,
        cleanup: () => rmSync(isolatedPath, { force: true, recursive: true }),
      });
    } catch {
      if (path) rmSync(path, { force: true, recursive: true });
      return err({
        kind: DevFailureKind.Command,
        message: 'Git could not create an isolated repository configuration',
      });
    }
  }

  private static linkMetadata(
    ...[destination, source, required, createIfMissing = false]: [
      destination: string,
      source: string,
      required: boolean,
      createIfMissing?: boolean,
    ]
  ): void {
    if (!existsSync(source)) {
      if (required) throw new Error(`Missing Git metadata: ${source}`);
      if (!createIfMissing) return;
    }
    symlinkSync(source, destination);
  }

  private static text(
    value: SpawnSyncReturns<string | Buffer>['stdout'],
  ): string {
    return typeof value === 'string'
      ? value
      : value instanceof Buffer
        ? value.toString('utf8')
        : '';
  }
}

export class CommandFailureMessage {
  constructor(private readonly request: CommandOutput) {}

  text(): string {
    const detail = this.request.stderr.trim() || this.request.stdout.trim();
    return detail || `command exited with status ${this.request.exitCode}`;
  }
}
