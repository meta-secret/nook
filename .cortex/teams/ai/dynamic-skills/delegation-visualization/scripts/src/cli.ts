#!/usr/bin/env bun
import { executeDelegationVisualizationApplication } from './application.ts';
import { decodeDelegationVisualizationRequest } from './codec.ts';

const REQUEST_ENV = 'NOOK_DELEGATION_VISUALIZATION_REQUEST_JSON';

export function renderDelegationVisualizationJson(serialized: string): string {
  const request = decodeDelegationVisualizationRequest(serialized);
  return executeDelegationVisualizationApplication(request).tree;
}

if (import.meta.main) {
  const serialized = process.env[REQUEST_ENV];
  if (serialized === undefined) {
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
