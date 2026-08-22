import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import type { MakeDirectoryOptions, RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  MODULE_EXPERT_READ_CONTEXT_TOOLS,
  createModuleExpertReadContextServer,
} from '../../src/module-experts/read-context-mcp.ts';
import type {
  ModuleExpertReadContextServer,
  ModuleExpertReadContextServerRequest,
} from '../../src/module-experts/read-context-mcp.ts';

type TestRepository = {
  readonly outsideFile: string;
  readonly root: string;
};

type TestToolArguments = {
  readonly depth?: number;
  readonly maxResults?: number;
  readonly path?: string;
  readonly query?: string;
  readonly unexpected?: string;
};

type McpRequest = {
  readonly id: number;
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: {
    readonly arguments: TestToolArguments;
    readonly name: string;
  };
};

type McpResponse = {
  readonly error?: { readonly code: number; readonly message: string };
  readonly result?: {
    readonly capabilities?: {
      readonly tools: { readonly listChanged: boolean };
    };
    readonly content?: readonly [
      { readonly text: string; readonly type: string },
    ];
    readonly tools?: readonly { readonly name: string }[];
  };
};

type McpCall = {
  readonly request: McpRequest;
  readonly server: ModuleExpertReadContextServer;
};

type McpRequestStreamController = {
  readonly close: () => void;
  readonly enqueue: (chunk: Uint8Array) => void;
};

type McpRequestStreamSource = {
  readonly start: (controller: McpRequestStreamController) => void;
};

describe('module expert read-context MCP', () => {
  test('implements initialize, exact tool discovery, read, list, and literal search', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-read-context-'));
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const repository = await createTestRepository(fixtureRoot);
      const serverRequest: ModuleExpertReadContextServerRequest = {
        repositoryRoot: repository.root,
      };
      const server = createModuleExpertReadContextServer(serverRequest);
      try {
        const initializeRequest: McpRequest = {
          id: 1,
          jsonrpc: '2.0',
          method: 'initialize',
        };
        const initializeCall: McpCall = { request: initializeRequest, server };
        const initialize = await callMcp(initializeCall);
        expect(initialize.result?.capabilities?.tools.listChanged).toBe(false);
        const toolsRequest: McpRequest = {
          id: 2,
          jsonrpc: '2.0',
          method: 'tools/list',
        };
        const toolsCall: McpCall = { request: toolsRequest, server };
        const tools = await callMcp(toolsCall);
        expect(tools.result?.tools?.map((tool) => tool.name)).toEqual([
          ...MODULE_EXPERT_READ_CONTEXT_TOOLS,
        ]);
        const readCall: ToolCall = {
          arguments: { path: 'src/domain.ts' },
          id: 3,
          name: 'read_file',
          server,
        };
        const read = await toolCall(readCall);
        expect(read.result?.content?.[0]?.text).toBe(
          'export const capability = "module-api";\n',
        );
        const listCall: ToolCall = {
          arguments: { depth: 2, path: 'src' },
          id: 4,
          name: 'list_files',
          server,
        };
        const list = await toolCall(listCall);
        expect(list.result?.content?.[0]?.text).toContain('src/domain.ts');
        const literalSearchCall: ToolCall = {
          arguments: { query: '[module-api]' },
          id: 5,
          name: 'search_text',
          server,
        };
        const literalSearch = await toolCall(literalSearchCall);
        expect(literalSearch.result?.content?.[0]?.text).toContain(
          'matches":[]',
        );
        const ordinarySearchCall: ToolCall = {
          arguments: { query: 'module-api' },
          id: 6,
          name: 'search_text',
          server,
        };
        const ordinarySearch = await toolCall(ordinarySearchCall);
        expect(ordinarySearch.result?.content?.[0]?.text).toContain(
          'src/domain.ts:1',
        );
      } finally {
        await server.dispose();
      }
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('rejects path escapes, symlinks, denied files, and extra arguments', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-read-context-deny-'),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const repository = await createTestRepository(fixtureRoot);
      const serverRequest: ModuleExpertReadContextServerRequest = {
        repositoryRoot: repository.root,
      };
      const server = createModuleExpertReadContextServer(serverRequest);
      try {
        const rejectedArguments: readonly TestToolArguments[] = [
          { path: '../outside.txt' },
          { path: repository.outsideFile },
          { path: 'src\\domain.ts' },
          { path: 'src/outside-link' },
          { path: 'src/inside-link' },
          { path: '.env' },
          { path: 'src/domain.ts', unexpected: 'value' },
        ];
        let id = 20;
        for (const toolArguments of rejectedArguments) {
          const rejectedCall: ToolCall = {
            arguments: toolArguments,
            id,
            name: 'read_file',
            server,
          };
          const response = await toolCall(rejectedCall);
          expect(response.error?.code).toBe(-32_602);
          id += 1;
        }
      } finally {
        await server.dispose();
      }
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('enforces request, file, result-count, and total-output bounds', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-read-context-bounds-'),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const repository = await createTestRepository(fixtureRoot);
      const serverRequest: ModuleExpertReadContextServerRequest = {
        repositoryRoot: repository.root,
      };
      const server = createModuleExpertReadContextServer(serverRequest);
      try {
        const oversizedFileCall: ToolCall = {
          arguments: { path: 'src/oversized.txt' },
          id: 40,
          name: 'read_file',
          server,
        };
        const oversizedFile = await toolCall(oversizedFileCall);
        expect(oversizedFile.error?.message).toContain('bounded regular file');
        const boundedSearchCall: ToolCall = {
          arguments: { maxResults: 3, query: 'bounded-match' },
          id: 41,
          name: 'search_text',
          server,
        };
        const boundedSearch = await toolCall(boundedSearchCall);
        const searchText = boundedSearch.result?.content?.[0]?.text ?? '';
        expect(searchText).toContain('"truncated":true');
        expect(Buffer.byteLength(searchText, 'utf8')).toBeLessThanOrEqual(
          262_144,
        );
        const oversizedRequest: McpRequest = {
          id: 42,
          jsonrpc: '2.0',
          method: `oversized-${'x'.repeat(70_000)}`,
        };
        const oversizedCall: McpCall = { request: oversizedRequest, server };
        const response = await callMcp(oversizedCall);
        expect(response.error?.message).toContain('byte limit');
        const chunkedResponse = await callChunkedOversizedMcp(server);
        expect(chunkedResponse.error?.message).toContain('byte limit');
        const expandingFileCall: ToolCall = {
          arguments: { path: 'src/expanding.txt' },
          id: 43,
          name: 'read_file',
          server,
        };
        const expandingFile = await toolCall(expandingFileCall);
        expect(expandingFile.error?.message).toContain(
          'response exceeds the byte limit',
        );
      } finally {
        await server.dispose();
      }
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('closes the per-attempt endpoint on disposal', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-read-context-close-'),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const repository = await createTestRepository(fixtureRoot);
      const serverRequest: ModuleExpertReadContextServerRequest = {
        repositoryRoot: repository.root,
      };
      const server = createModuleExpertReadContextServer(serverRequest);
      await server.dispose();
      await server.dispose();
      const request: McpRequest = { id: 50, jsonrpc: '2.0', method: 'ping' };
      const closedCall: McpCall = { request, server };
      await expect(callMcp(closedCall)).rejects.toThrow();
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });
});

type ToolCall = {
  readonly arguments: TestToolArguments;
  readonly id: number;
  readonly name: string;
  readonly server: ModuleExpertReadContextServer;
};

function toolCall(call: ToolCall): Promise<McpResponse> {
  const request: McpRequest = {
    id: call.id,
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { arguments: call.arguments, name: call.name },
  };
  const mcpCall: McpCall = { request, server: call.server };
  return callMcp(mcpCall);
}

async function callMcp(call: McpCall): Promise<McpResponse> {
  const headers = new Headers();
  headers.set('accept', 'application/json, text/event-stream');
  headers.set('content-type', 'application/json');
  const requestOptions: RequestInit = {
    body: JSON.stringify(call.request),
    headers,
    method: 'POST',
  };
  const response = await fetch(call.server.url, requestOptions);
  return (await response.json()) as McpResponse;
}

async function callChunkedOversizedMcp(
  server: ModuleExpertReadContextServer,
): Promise<McpResponse> {
  const first = Buffer.from('{"jsonrpc":"2.0","id":44,"method":"');
  const second = Buffer.from(`${'x'.repeat(70_000)}"}`);
  const streamSource: McpRequestStreamSource = {
    start: (controller) => {
      controller.enqueue(first);
      controller.enqueue(second);
      controller.close();
    },
  };
  const stream = new ReadableStream<Uint8Array>(streamSource);
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  const requestOptions: RequestInit = {
    body: stream,
    headers,
    method: 'POST',
  };
  const response = await fetch(server.url, requestOptions);
  return (await response.json()) as McpResponse;
}

async function createTestRepository(
  fixtureRoot: string,
): Promise<TestRepository> {
  const root = join(fixtureRoot, 'repository');
  const sourceDirectory = join(root, 'src');
  const recursiveDirectoryOptions: MakeDirectoryOptions = { recursive: true };
  await mkdir(sourceDirectory, recursiveDirectoryOptions);
  await writeFile(
    join(sourceDirectory, 'domain.ts'),
    'export const capability = "module-api";\n',
    'utf8',
  );
  await writeFile(
    join(sourceDirectory, 'matches.txt'),
    `${'bounded-match '.repeat(20)}\n`.repeat(100),
    'utf8',
  );
  await writeFile(
    join(sourceDirectory, 'oversized.txt'),
    'o'.repeat(256 * 1024 + 1),
    'utf8',
  );
  await writeFile(
    join(sourceDirectory, 'expanding.txt'),
    '\\"'.repeat(110_000),
    'utf8',
  );
  await writeFile(join(root, '.env'), 'SECRET=value\n', 'utf8');
  const outsideFile = join(fixtureRoot, 'outside.txt');
  await writeFile(outsideFile, 'outside\n', 'utf8');
  await symlink(outsideFile, join(sourceDirectory, 'outside-link'));
  await symlink('domain.ts', join(sourceDirectory, 'inside-link'));
  return { outsideFile, root };
}
