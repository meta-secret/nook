export {};

await Bun.stdin.text();
await Bun.write(Bun.stdout, 'x'.repeat(1024));
