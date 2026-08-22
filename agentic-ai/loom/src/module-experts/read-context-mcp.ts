import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import type { Dirent, ObjectEncodingOptions } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const MAX_DIRECTORY_DEPTH = 4;
const MAX_LISTED_FILES = 200;
const MAX_SEARCHED_FILES = 5_000;
const MAX_SEARCHED_BYTES = 4 * 1024 * 1024;
const MAX_READ_BYTES = 256 * 1024;
const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 100;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RESULT_LINE_BYTES = 2_000;
const MAX_REQUEST_BYTES = 65_536;
export const MODULE_EXPERT_READ_CONTEXT_TOOLS = [
  'list_files',
  'read_file',
  'search_text',
] as const;
const DENIED_SEGMENTS = new Set([
  '.git',
  '.codex',
  '.cortex/.session',
  'node_modules',
  'target',
]);

enum JsonSchemaValueKind {
  Integer = 'integer',
  Object = 'object',
  String = 'string',
}

enum McpContentKind {
  Text = 'text',
}

type JsonRpcId = number | string;

type ToolArguments = {
  readonly depth?: number;
  readonly maxResults?: number;
  readonly path?: string;
  readonly query?: string;
};

type ToolCallParams = {
  readonly arguments?: ToolArguments;
  readonly name?: string;
};

type ValidToolCallParams = {
  readonly arguments: ToolArguments;
  readonly name: string;
};

type JsonRpcRequest = {
  readonly id?: JsonRpcId;
  readonly jsonrpc?: string;
  readonly method?: string;
  readonly params?: ToolCallParams;
};

type IdentifiedJsonRpcRequest = JsonRpcRequest & {
  readonly id: JsonRpcId;
};

function hasJsonRpcId(
  request: JsonRpcRequest,
): request is IdentifiedJsonRpcRequest {
  return typeof request.id === 'number' || typeof request.id === 'string';
}

type McpInitializeResult = {
  readonly capabilities: { readonly tools: { readonly listChanged: false } };
  readonly protocolVersion: string;
  readonly serverInfo: { readonly name: string; readonly version: string };
};

type McpInputProperty = {
  readonly type: JsonSchemaValueKind;
  readonly maximum?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly minLength?: number;
};

type McpToolDefinition = {
  readonly description: string;
  readonly inputSchema: {
    readonly additionalProperties: false;
    readonly properties: Readonly<Record<string, McpInputProperty>>;
    readonly required?: readonly string[];
    readonly type: JsonSchemaValueKind.Object;
  };
  readonly name: string;
};

type McpToolsListResult = {
  readonly tools: readonly McpToolDefinition[];
};

type McpToolCallResult = {
  readonly content: readonly [
    { readonly text: string; readonly type: McpContentKind.Text },
  ];
};

type McpResult =
  | McpInitializeResult
  | McpToolsListResult
  | McpToolCallResult
  | Readonly<Record<string, never>>;

type JsonRpcResponse = {
  readonly id?: JsonRpcId;
  readonly jsonrpc: '2.0';
  readonly result?: McpResult;
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
};

type ToolCallRequest = {
  readonly arguments: ToolArguments;
  readonly name: string;
};

type RepositoryContext = {
  readonly root: string;
};

type ResolvedRepositoryPath = {
  readonly absolutePath: string;
  readonly relativePath: string;
};

type WalkRequest = {
  readonly context: RepositoryContext;
  readonly depth: number;
  readonly path: ResolvedRepositoryPath;
  readonly visit: (path: ResolvedRepositoryPath) => boolean;
};

type SearchState = {
  readonly matches: string[];
  readonly query: string;
  outputBytes: number;
  searchedBytes: number;
  searchedFiles: number;
};

type DirectoryEntryComparison = [Dirent, Dirent];

type ListedFilesResult = {
  readonly files: readonly string[];
  readonly truncated: boolean;
};

type SearchTextResult = {
  readonly matches: readonly string[];
  readonly searchedBytes: number;
  readonly searchedFiles: number;
  readonly truncated: boolean;
};

export type ModuleExpertReadContextServerRequest = {
  readonly repositoryRoot: string;
};

export type ModuleExpertReadContextServer = {
  readonly dispose: () => Promise<void>;
  readonly url: string;
};

export function createModuleExpertReadContextServer(
  request: ModuleExpertReadContextServerRequest,
): ModuleExpertReadContextServer {
  const context: RepositoryContext = {
    root: realpathSync(request.repositoryRoot),
  };
  const endpoint = randomBytes(32).toString('hex');
  const serverOptions: Bun.Serve.Options<never> = {
    hostname: '127.0.0.1',
    port: 0,
    fetch: (incomingRequest) => {
      const httpRequest: ModuleExpertReadContextHttpRequest = {
        context,
        endpoint,
        request: incomingRequest,
      };
      return handleHttpRequest(httpRequest);
    },
  };
  const server = Bun.serve(serverOptions);
  let disposed = false;
  return {
    url: `http://127.0.0.1:${server.port}/${endpoint}`,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await server.stop(true);
    },
  };
}

type ModuleExpertReadContextHttpRequest = {
  readonly context: RepositoryContext;
  readonly endpoint: string;
  readonly request: Request;
};

async function handleHttpRequest(
  incoming: ModuleExpertReadContextHttpRequest,
): Promise<Response> {
  const url = new URL(incoming.request.url);
  const declaredLength = Number(
    incoming.request.headers.get('content-length') ?? '0',
  );
  if (
    url.pathname !== `/${incoming.endpoint}` ||
    incoming.request.method !== 'POST'
  ) {
    const responseOptions: ResponseInit = { status: 404 };
    return new Response('Not found.', responseOptions);
  }
  if (declaredLength > MAX_REQUEST_BYTES) {
    const errorWrite: JsonRpcErrorWrite = {
      code: -32_600,
      message: 'JSON-RPC request exceeds the byte limit.',
    };
    return jsonRpcErrorResponse(errorWrite);
  }
  let body: string;
  try {
    const boundedBodyRequest: BoundedMcpRequestBody = {
      request: incoming.request,
    };
    body = await readBoundedRequestBody(boundedBodyRequest);
  } catch {
    const errorWrite: JsonRpcErrorWrite = {
      code: -32_600,
      message: 'JSON-RPC request exceeds the byte limit.',
    };
    return jsonRpcErrorResponse(errorWrite);
  }
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(body) as JsonRpcRequest;
  } catch {
    const errorWrite: JsonRpcErrorWrite = {
      code: -32_700,
      message: 'Invalid JSON.',
    };
    return jsonRpcErrorResponse(errorWrite);
  }
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    const errorWrite: JsonRpcErrorWrite = {
      code: -32_600,
      message: 'Invalid JSON-RPC request.',
    };
    if (hasJsonRpcId(request)) {
      const identifiedErrorWrite: IdentifiedJsonRpcErrorWrite = {
        ...errorWrite,
        id: request.id,
      };
      return jsonRpcErrorResponse(identifiedErrorWrite);
    }
    return jsonRpcErrorResponse(errorWrite);
  }
  if (!hasJsonRpcId(request)) {
    const responseOptions: ResponseInit = { status: 202 };
    return new Response('', responseOptions);
  }
  try {
    const dispatchRequest: DispatchRequest = {
      context: incoming.context,
      request,
    };
    const resultWrite: JsonRpcResultWrite = {
      id: request.id,
      result: dispatch(dispatchRequest),
    };
    return jsonRpcResultResponse(resultWrite);
  } catch (error) {
    const errorWrite: IdentifiedJsonRpcErrorWrite = {
      id: request.id,
      code: -32_602,
      message: error instanceof Error ? error.message : 'Tool call failed.',
    };
    return jsonRpcErrorResponse(errorWrite);
  }
}

type JsonRpcErrorWrite = {
  readonly code: number;
  readonly message: string;
};

type IdentifiedJsonRpcErrorWrite = JsonRpcErrorWrite & {
  readonly id: JsonRpcId;
};

function jsonRpcErrorResponse(write: JsonRpcErrorWrite): Response {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    error: { code: write.code, message: write.message },
  };
  if ('id' in write) {
    const identifiedResponse: JsonRpcResponse = {
      ...response,
      id: (write as IdentifiedJsonRpcErrorWrite).id,
    };
    return jsonResponse(identifiedResponse);
  }
  return jsonResponse(response);
}

type JsonRpcResultWrite = {
  readonly id: JsonRpcId;
  readonly result: McpResult;
};

function jsonRpcResultResponse(write: JsonRpcResultWrite): Response {
  const response: JsonRpcResponse = {
    id: write.id,
    jsonrpc: '2.0',
    result: write.result,
  };
  return jsonResponse(response);
}

function jsonResponse(response: JsonRpcResponse): Response {
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  const responseOptions: ResponseInit = { headers };
  return new Response(JSON.stringify(response), responseOptions);
}

type BoundedMcpRequestBody = {
  readonly request: Request;
};

async function readBoundedRequestBody(
  bodyRequest: BoundedMcpRequestBody,
): Promise<string> {
  if (!bodyRequest.request.body) return '';
  const reader = bodyRequest.request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const read = await reader.read();
    if (read.done) break;
    bytes += read.value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error('JSON-RPC request exceeds the byte limit.');
    }
    chunks[chunks.length] = read.value;
  }
  return Buffer.concat(chunks).toString('utf8');
}

type DispatchRequest = {
  readonly context: RepositoryContext;
  readonly request: JsonRpcRequest;
};

function dispatch(request: DispatchRequest): McpResult {
  if (request.request.method === 'initialize') {
    return {
      capabilities: { tools: { listChanged: false } },
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'nook-read-context', version: '1.0.0' },
    };
  }
  if (request.request.method === 'ping') return {};
  if (request.request.method === 'tools/list') {
    return { tools: toolDefinitions() };
  }
  if (request.request.method === 'tools/call') {
    const call = decodeToolCall(request.request.params);
    const toolExecution: ToolExecutionRequest = {
      call,
      context: request.context,
    };
    const text = callTool(toolExecution);
    const result: McpToolCallResult = {
      content: [{ type: McpContentKind.Text, text }],
    };
    if (
      Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RESPONSE_BYTES
    ) {
      throw new Error('MCP tool response exceeds the byte limit.');
    }
    return result;
  }
  throw new Error('Unsupported MCP method.');
}

function toolDefinitions(): readonly McpToolDefinition[] {
  return [
    {
      name: MODULE_EXPERT_READ_CONTEXT_TOOLS[0],
      description: 'List bounded regular files under one repository directory.',
      inputSchema: {
        type: JsonSchemaValueKind.Object,
        additionalProperties: false,
        properties: {
          depth: {
            type: JsonSchemaValueKind.Integer,
            minimum: 0,
            maximum: MAX_DIRECTORY_DEPTH,
          },
          path: { type: JsonSchemaValueKind.String, maxLength: 500 },
        },
      },
    },
    {
      name: MODULE_EXPERT_READ_CONTEXT_TOOLS[1],
      description: 'Read one bounded UTF-8 repository file.',
      inputSchema: {
        type: JsonSchemaValueKind.Object,
        additionalProperties: false,
        properties: {
          path: {
            type: JsonSchemaValueKind.String,
            minLength: 1,
            maxLength: 500,
          },
        },
        required: ['path'],
      },
    },
    {
      name: MODULE_EXPERT_READ_CONTEXT_TOOLS[2],
      description:
        'Search for a bounded literal string in regular repository files.',
      inputSchema: {
        type: JsonSchemaValueKind.Object,
        additionalProperties: false,
        properties: {
          path: { type: JsonSchemaValueKind.String, maxLength: 500 },
          query: {
            type: JsonSchemaValueKind.String,
            minLength: 2,
            maxLength: MAX_QUERY_LENGTH,
          },
          maxResults: {
            type: JsonSchemaValueKind.Integer,
            minimum: 1,
            maximum: MAX_RESULTS,
          },
        },
        required: ['query'],
      },
    },
  ];
}

function decodeToolCall(params?: ToolCallParams): ToolCallRequest {
  if (!isValidToolCallParams(params)) {
    throw new Error('Invalid MCP tool call.');
  }
  if (
    !MODULE_EXPERT_READ_CONTEXT_TOOLS.includes(
      params.name as (typeof MODULE_EXPERT_READ_CONTEXT_TOOLS)[number],
    )
  ) {
    throw new Error('Unsupported MCP tool.');
  }
  return { name: params.name, arguments: params.arguments };
}

type ToolExecutionRequest = {
  readonly call: ToolCallRequest;
  readonly context: RepositoryContext;
};

function callTool(request: ToolExecutionRequest): string {
  const toolRequest: ToolValuesRequest = {
    context: request.context,
    values: request.call.arguments,
  };
  if (request.call.name === 'list_files') return listFiles(toolRequest);
  if (request.call.name === 'read_file') return readFile(toolRequest);
  return searchText(toolRequest);
}

type ToolValuesRequest = {
  readonly context: RepositoryContext;
  readonly values: ToolArguments;
};

function listFiles(request: ToolValuesRequest): string {
  const keyAssertion: KeyAssertion = {
    actual: Object.keys(request.values),
    allowed: ['depth', 'path'],
  };
  assertOnlyKeys(keyAssertion);
  const integerRequest: IntegerValueRequest = {
    value: optionalNumberArgument(request.values.depth),
    fallback: 1,
    minimum: 0,
    maximum: MAX_DIRECTORY_DEPTH,
  };
  const depth = integerValue(integerRequest);
  const stringRequest: StringValueRequest = {
    value: optionalStringArgument(request.values.path),
    fallback: '.',
  };
  const resolveRequest: ResolveRepositoryPathRequest = {
    context: request.context,
    inputPath: stringValue(stringRequest),
    expectDirectory: true,
  };
  const start = resolveRepositoryPath(resolveRequest);
  const paths: string[] = [];
  const walkRequest: WalkRequest = {
    context: request.context,
    depth,
    path: start,
    visit: (path) => {
      paths[paths.length] = path.relativePath;
      return paths.length < MAX_LISTED_FILES;
    },
  };
  walkFiles(walkRequest);
  const result: ListedFilesResult = {
    files: paths,
    truncated: paths.length >= MAX_LISTED_FILES,
  };
  return JSON.stringify(result);
}

function readFile(request: ToolValuesRequest): string {
  const keyAssertion: KeyAssertion = {
    actual: Object.keys(request.values),
    allowed: ['path'],
  };
  assertOnlyKeys(keyAssertion);
  const resolveRequest: ResolveRepositoryPathRequest = {
    context: request.context,
    inputPath: requiredString(request.values.path),
    expectDirectory: false,
  };
  const path = resolveRepositoryPath(resolveRequest);
  const stats = lstatSync(path.absolutePath);
  if (!stats.isFile() || stats.size > MAX_READ_BYTES) {
    throw new Error('Repository file is not a bounded regular file.');
  }
  const content = readFileSync(path.absolutePath, 'utf8');
  if (content.includes('\u0000'))
    throw new Error('Binary files are not readable.');
  return content;
}

function searchText(request: ToolValuesRequest): string {
  const keyAssertion: KeyAssertion = {
    actual: Object.keys(request.values),
    allowed: ['maxResults', 'path', 'query'],
  };
  assertOnlyKeys(keyAssertion);
  const query = requiredString(request.values.query);
  if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
    throw new Error('Search query length is outside the allowed range.');
  }
  const integerRequest: IntegerValueRequest = {
    value: optionalNumberArgument(request.values.maxResults),
    fallback: 50,
    minimum: 1,
    maximum: MAX_RESULTS,
  };
  const maxResults = integerValue(integerRequest);
  const stringRequest: StringValueRequest = {
    value: optionalStringArgument(request.values.path),
    fallback: '.',
  };
  const resolveRequest: ResolveRepositoryPathRequest = {
    context: request.context,
    inputPath: stringValue(stringRequest),
    expectDirectory: true,
  };
  const start = resolveRepositoryPath(resolveRequest);
  const state: SearchState = {
    matches: [],
    outputBytes: 0,
    query,
    searchedBytes: 0,
    searchedFiles: 0,
  };
  const walkRequest: WalkRequest = {
    context: request.context,
    depth: MAX_DIRECTORY_DEPTH,
    path: start,
    visit: (path) => {
      const searchFileRequest: SearchFileRequest = { maxResults, path, state };
      return searchFile(searchFileRequest);
    },
  };
  walkFiles(walkRequest);
  const result: SearchTextResult = {
    matches: state.matches,
    searchedBytes: state.searchedBytes,
    searchedFiles: state.searchedFiles,
    truncated:
      state.matches.length >= maxResults ||
      state.outputBytes >= MAX_RESPONSE_BYTES ||
      state.searchedBytes >= MAX_SEARCHED_BYTES ||
      state.searchedFiles >= MAX_SEARCHED_FILES,
  };
  return JSON.stringify(result);
}

type SearchFileRequest = {
  readonly maxResults: number;
  readonly path: ResolvedRepositoryPath;
  readonly state: SearchState;
};

function searchFile(request: SearchFileRequest): boolean {
  if (
    request.state.matches.length >= request.maxResults ||
    request.state.outputBytes >= MAX_RESPONSE_BYTES ||
    request.state.searchedFiles >= MAX_SEARCHED_FILES ||
    request.state.searchedBytes >= MAX_SEARCHED_BYTES
  ) {
    return false;
  }
  const stats = lstatSync(request.path.absolutePath);
  if (!stats.isFile() || stats.size > MAX_READ_BYTES) return true;
  if (request.state.searchedBytes + stats.size > MAX_SEARCHED_BYTES)
    return false;
  request.state.searchedFiles += 1;
  request.state.searchedBytes += stats.size;
  const content = readFileSync(request.path.absolutePath, 'utf8');
  if (content.includes('\u0000')) return true;
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.includes(request.state.query)) continue;
    const boundedLine = Buffer.from(line, 'utf8')
      .subarray(0, MAX_RESULT_LINE_BYTES)
      .toString('utf8');
    const match = `${request.path.relativePath}:${index + 1}:${boundedLine}`;
    const matchBytes = Buffer.byteLength(match, 'utf8');
    if (request.state.outputBytes + matchBytes > MAX_RESPONSE_BYTES)
      return false;
    request.state.matches[request.state.matches.length] = match;
    request.state.outputBytes += matchBytes;
    if (request.state.matches.length >= request.maxResults) return false;
  }
  return true;
}

function walkFiles(request: WalkRequest): boolean {
  if (request.depth < 0) return true;
  const entries = sortedDirectoryEntries(request.path.absolutePath);
  for (const entry of entries) {
    const relativePath = relative(
      request.context.root,
      resolve(request.path.absolutePath, entry.name),
    );
    if (isDeniedPath(relativePath) || entry.isSymbolicLink()) continue;
    const resolveRequest: ResolveRepositoryPathRequest = {
      context: request.context,
      inputPath: relativePath,
      expectDirectory: entry.isDirectory(),
    };
    const child = resolveRepositoryPath(resolveRequest);
    if (entry.isDirectory()) {
      if (request.depth === 0) continue;
      const nested: WalkRequest = {
        ...request,
        depth: request.depth - 1,
        path: child,
      };
      if (!walkFiles(nested)) return false;
      continue;
    }
    if (entry.isFile() && !request.visit(child)) return false;
  }
  return true;
}

function sortedDirectoryEntries(path: string): readonly Dirent[] {
  const options: ObjectEncodingOptions & { withFileTypes: true } = {
    withFileTypes: true,
  };
  return readdirSync(path, options).sort(
    (...entries: DirectoryEntryComparison) => {
      const [left, right] = entries;
      return left.name.localeCompare(right.name);
    },
  );
}

type ResolveRepositoryPathRequest = {
  readonly context: RepositoryContext;
  readonly inputPath: string;
  readonly expectDirectory: boolean;
};

function resolveRepositoryPath(
  request: ResolveRepositoryPathRequest,
): ResolvedRepositoryPath {
  if (
    !request.inputPath ||
    request.inputPath.length > 500 ||
    request.inputPath.includes('\u0000') ||
    request.inputPath.includes('\\') ||
    isAbsolute(request.inputPath)
  ) {
    throw new Error('Repository path must be bounded and relative.');
  }
  const unresolvedPath = resolve(request.context.root, request.inputPath);
  const unresolvedRelativePath = relative(request.context.root, unresolvedPath);
  if (
    unresolvedRelativePath === '..' ||
    unresolvedRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(unresolvedRelativePath) ||
    isDeniedPath(unresolvedRelativePath)
  ) {
    throw new Error('Repository path escapes or enters a denied scope.');
  }
  const symbolicLinkAssertion: SymbolicLinkComponentsAssertion = {
    context: request.context,
    relativePath: unresolvedRelativePath,
  };
  assertNoSymbolicLinkComponents(symbolicLinkAssertion);
  const absolutePath = realpathSync(unresolvedPath);
  const relativePath = relative(request.context.root, absolutePath);
  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink())
    throw new Error('Symbolic links are not readable.');
  if (request.expectDirectory !== stats.isDirectory()) {
    throw new Error('Repository path has the wrong kind.');
  }
  return { absolutePath, relativePath: relativePath || '.' };
}

type SymbolicLinkComponentsAssertion = {
  readonly context: RepositoryContext;
  readonly relativePath: string;
};

function assertNoSymbolicLinkComponents(
  assertion: SymbolicLinkComponentsAssertion,
): void {
  let candidate = assertion.context.root;
  for (const segment of assertion.relativePath.split(sep)) {
    if (!segment || segment === '.') continue;
    candidate = resolve(candidate, segment);
    if (lstatSync(candidate).isSymbolicLink()) {
      throw new Error('Symbolic links are not readable.');
    }
  }
}

function isDeniedPath(path: string): boolean {
  const normalized = path.split(sep).join('/');
  const segments = normalized.split('/');
  if (
    segments.some(
      (segment) => segment === '.env' || segment.startsWith('.env.'),
    )
  ) {
    return true;
  }
  return [...DENIED_SEGMENTS].some(
    (denied) => normalized === denied || normalized.startsWith(`${denied}/`),
  );
}

type KeyAssertion = {
  readonly actual: readonly string[];
  readonly allowed: readonly string[];
};

function assertOnlyKeys(assertion: KeyAssertion): void {
  if (assertion.actual.some((key) => !assertion.allowed.includes(key))) {
    throw new Error('Unexpected tool argument.');
  }
}

function isValidToolCallParams(
  value?: ToolCallParams,
): value is ValidToolCallParams {
  return (
    typeof value === 'object' &&
    Boolean(value) &&
    typeof value.name === 'string' &&
    typeof value.arguments === 'object' &&
    Boolean(value.arguments) &&
    !Array.isArray(value.arguments)
  );
}

enum OptionalArgumentKind {
  Omitted = 'omitted',
  Provided = 'provided',
}

type OptionalStringArgument =
  | { readonly kind: OptionalArgumentKind.Omitted }
  | { readonly kind: OptionalArgumentKind.Provided; readonly value: string };

type StringValueRequest = {
  readonly value: OptionalStringArgument;
  readonly fallback: string;
};

function stringValue(request: StringValueRequest): string {
  if (request.value.kind === OptionalArgumentKind.Omitted) {
    return request.fallback;
  }
  return requiredString(request.value.value);
}

function optionalStringArgument(value?: string): OptionalStringArgument {
  return typeof value === 'string'
    ? { kind: OptionalArgumentKind.Provided, value }
    : { kind: OptionalArgumentKind.Omitted };
}

function requiredString(value?: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error('Expected a non-empty string.');
  }
  return value;
}

type OptionalNumberArgument =
  | { readonly kind: OptionalArgumentKind.Omitted }
  | { readonly kind: OptionalArgumentKind.Provided; readonly value: number };

type IntegerValueRequest = {
  readonly value: OptionalNumberArgument;
  readonly fallback: number;
  readonly minimum: number;
  readonly maximum: number;
};

function integerValue(request: IntegerValueRequest): number {
  const value =
    request.value.kind === OptionalArgumentKind.Provided
      ? request.value.value
      : request.fallback;
  if (
    !Number.isInteger(value) ||
    value < request.minimum ||
    value > request.maximum
  ) {
    throw new Error('Integer tool argument is outside the allowed range.');
  }
  return value;
}

function optionalNumberArgument(value?: number): OptionalNumberArgument {
  return typeof value === 'number'
    ? { kind: OptionalArgumentKind.Provided, value }
    : { kind: OptionalArgumentKind.Omitted };
}
