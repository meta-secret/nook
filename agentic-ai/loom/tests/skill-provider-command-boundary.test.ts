import { expect, test } from 'bun:test';
import {
  analyzeShellCommands,
  type ShellCommandInspection,
} from './skill-provider-command-boundary.ts';
import {
  AUDITED_SOURCE_SEAMS,
  isAuditedSource,
  type AuditedSourceRequest,
} from './skill-provider-sourced-seams.ts';

const PROTECTED =
  '.cortex/teams/ai/dynamic-skills/example-skill/scripts/src/cli.ts';
const PROTECTED_ROOT = PROTECTED.slice(0, PROTECTED.lastIndexOf('/'));

function inspectShell(source: string) {
  const inspection: ShellCommandInspection = {
    positionalArguments: false,
    source,
    sourcePath: false,
  };
  return analyzeShellCommands(inspection);
}

function inspectProtected(source: string) {
  const analysis = inspectShell(source);
  if (
    analysis.launches.some(
      (launch) =>
        launch.specifier.includes('.cortex') &&
        launch.specifier.includes('dynamic-skills') &&
        launch.specifier.includes('/scripts/'),
    )
  )
    throw new Error('Protected executable-skill launch.');
  return analysis;
}

test('rejects every protected runtime construction and masked launch', () => {
  const fixtures = [
    `bun ${PROTECTED.replace('example-skill', 'exampl?-skill')}`,
    `cd .cortex/teams/ai/dynamic-skills/example-skill/scripts && bun src/cli.ts`,
    ...['--cwd .', '--watch', '--'].map((flag) => `bun ${flag} ${PROTECTED}`),
    `bash -c 'bun ${PROTECTED}'`,
    `a=${PROTECTED}; b=$a; bun "$b"`,
    'bun "${A:-.cortex}/teams/ai/${B:-dynamic-skills}/example-skill/scripts/src/cli.ts"',
    `runner=$RUNTIME; "$runner" ${PROTECTED}`,
    '"$UNBOUND"',
    'TARGET=$USER_INPUT; cd "$TARGET"; bun src/cli.ts',
    'cd "${A:-.cortex}/teams/ai/${B:-dynamic-skills}/example/scripts"; bun src/cli.ts',
    `eval 'bun ${PROTECTED}'`,
    `alias audit='bun ${PROTECTED}'; audit`,
    'task skills:tools-$(printf list)',
  ];
  for (const source of fixtures)
    expect(() => inspectProtected(source), source).toThrow();
  for (const source of [
    `${'command '.repeat(33)}bun scripts/catalog.ts`,
    `${'env '.repeat(32)}bun scripts/catalog.ts`,
  ])
    expect(() => inspectShell(source), source).toThrow();
  for (const source of [`env -S 'bun ${PROTECTED}'`])
    expect(() => inspectShell(source), source).toThrow(
      'Unsupported env option',
    );
});

test('enforces UTF-8 source and token bounds before classification', () => {
  expect(() => inspectShell(`#${'a'.repeat(65_535)}`)).not.toThrow();
  expect(() => inspectShell(`#${'a'.repeat(65_536)}`)).toThrow(
    'UTF-8 byte bound',
  );
  expect(() => inspectShell('word '.repeat(4_097))).toThrow('token count');
});

test('preserves shell execution semantics around state and branches', () => {
  for (const source of [
    `ROOT=${PROTECTED_ROOT}; ROOT=scripts true; bun "$ROOT/cli.ts"`,
    `audit(){ bun ${PROTECTED}; }; audit; audit(){ bun scripts/safe.ts; }`,
    `case x in x) bun ${PROTECTED};; esac`,
    `ROOT=${PROTECTED_ROOT}; false && ROOT=scripts; bun "$ROOT/cli.ts"`,
    `bash -c 'bun "$1"' _ ${PROTECTED}`,
  ])
    expect(() => inspectProtected(source), source).toThrow();
});

test('rejects indirect executable shell input', () => {
  for (const source of [
    `bash <(printf 'bun ${PROTECTED}')`,
    `bash <<'EOF'\nbun ${PROTECTED}\nEOF`,
    `npm exec -c 'bun ${PROTECTED}'`,
    `[[ $(bun ${PROTECTED}) = x ]]`,
    `trap 'bun ${PROTECTED}' EXIT`,
    `PATH=${PROTECTED_ROOT}:$PATH bun scripts/safe.ts`,
  ])
    expect(() => inspectProtected(source), source).toThrow();
});

test('accepts bounded static shell structures', () => {
  for (const source of [
    'cleanup(){ rm -f output; }; trap cleanup EXIT',
    'case x in x) bun scripts/safe.ts;; esac',
    "bash <<'EOF'\necho ok\nEOF",
    'while read -r value; do echo "$value"; done < <(printf ok)',
  ])
    expect(() => inspectProtected(source), source).not.toThrow();
});

test('closes the exact-head shell review batch', () => {
  for (const source of [
    `ROOT=${PROTECTED_ROOT}; env ROOT=scripts true; bun "$ROOT/cli.ts"`,
    `ROOT=${PROTECTED_ROOT}; ROOT=scripts | cat; bun "$ROOT/cli.ts"`,
    `node --require ${PROTECTED} scripts/safe.js`,
    `/usr/bin/node ${PROTECTED}`,
    `printf '%s' 'bun ${PROTECTED}' | bash`,
    `>/tmp/output bun ${PROTECTED}`,
    `if ! bun ${PROTECTED}; then true; fi`,
    `bun .cortex/teams/ai/dynamic-{skills,other}/example-skill/scripts/src/cli.ts`,
    `timeout 10 bun ${PROTECTED}`,
    `nice -n 5 bun ${PROTECTED}`,
    `bun test ${PROTECTED}`,
    `cd -P ${PROTECTED_ROOT}; bun cli.ts`,
  ])
    expect(() => inspectProtected(source), source).toThrow();
  for (const seam of AUDITED_SOURCE_SEAMS) {
    const sourceRequest: AuditedSourceRequest = {
      source: seam.specifier,
      sourcePath: seam.sourcePath,
    };
    expect(isAuditedSource(sourceRequest), seam.sourcePath).toBeTrue();
  }
});
