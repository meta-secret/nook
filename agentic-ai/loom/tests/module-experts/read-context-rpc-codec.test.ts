import { expect, test } from 'bun:test';
import {
  RepositoryContextRpcSchema,
  ToolCallDecodeKind,
} from '../../src/module-experts/read-context-rpc-codec.ts';

test('admits concrete repository tool arguments and preserves request identity', () => {
  const request = RepositoryContextRpcSchema.decodeJsonRpcRequest({
    jsonrpc: '2.0',
    id: 12,
    method: 'tools/call',
    params: { name: 'read_file', arguments: { path: 'src/domain.ts' } },
  });
  expect(request.id).toBe(12);
  expect(request.params).toEqual({
    kind: ToolCallDecodeKind.Valid,
    call: { name: 'read_file', arguments: { path: 'src/domain.ts' } },
  });
});

test('retains unsupported parameter failures as a typed admission outcome', () => {
  const request = RepositoryContextRpcSchema.decodeJsonRpcRequest({
    jsonrpc: '2.0',
    id: 'request',
    method: 'tools/call',
    params: {
      name: 'read_file',
      arguments: { path: 'src/domain.ts', depth: 4 },
    },
  });
  expect(request.params).toEqual({
    kind: ToolCallDecodeKind.Invalid,
    message: 'Unexpected tool argument.',
  });
  expect(request.id).toBe('request');
});

test('rejects non-object envelopes before dispatch', () => {
  expect(RepositoryContextRpcSchema.decodeJsonRpcRequest([])).toEqual({});
});
