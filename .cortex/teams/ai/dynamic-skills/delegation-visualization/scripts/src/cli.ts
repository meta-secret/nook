#!/usr/bin/env bun
import { executeDelegationVisualizationApplication } from './application.ts';
import { decodeDelegationVisualizationRequest } from './codec.ts';

export function renderDelegationVisualizationJson(serialized: string): string {
  const request = decodeDelegationVisualizationRequest(serialized);
  return executeDelegationVisualizationApplication(request).tree;
}

if (import.meta.main) {
  const serialized = await Bun.stdin.text();
  if (serialized === '') {
    console.error('Missing delegation visualization request.');
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(renderDelegationVisualizationJson(serialized));
    } catch {
      console.error('Invalid delegation visualization request.');
      process.exitCode = 1;
    }
  }
}
