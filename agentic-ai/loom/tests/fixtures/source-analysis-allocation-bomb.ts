const allocations: Uint8Array[] = [];

while (true) {
  allocations.push(new Uint8Array(16 * 1024 * 1024));
  const allocation = allocations.at(-1);
  if (allocation) allocation.fill(1);
}
