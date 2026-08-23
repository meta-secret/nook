import { lstat } from 'node:fs/promises';

await Bun.stdin.text();

let writeBlocked = false;
try {
  await Bun.write(
    '/skills/cortex-article-structure/forbidden.txt',
    'forbidden',
  );
} catch {
  writeBlocked = true;
}

let networkBlocked = false;
try {
  await fetch('https://example.com');
} catch {
  networkBlocked = true;
}

const credentialAbsent =
  typeof Bun.env.NOOK_EXECUTABLE_SKILL_HOST_CREDENTIAL !== 'string';
const nodeModulesAbsent = await lstat('/skills/node_modules').then(
  () => false,
  (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
);
const environment = Object.keys(Bun.env)
  .sort()
  .map((name) => `${name}=${Bun.env[name] ?? ''}`);
const result = {
  credentialAbsent,
  environment,
  networkBlocked,
  nodeModulesAbsent,
  writeBlocked,
};
await Bun.write(Bun.stdout, JSON.stringify(result));
