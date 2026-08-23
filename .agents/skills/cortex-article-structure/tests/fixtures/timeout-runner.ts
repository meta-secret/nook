export {};

await Bun.stdin.text();
await Bun.write(Bun.stderr, 'verification-started');
await new Promise<never>(() => {});
