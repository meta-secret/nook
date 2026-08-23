export {};

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
const result = { credentialAbsent, networkBlocked, writeBlocked };
await Bun.write(Bun.stdout, JSON.stringify(result));
