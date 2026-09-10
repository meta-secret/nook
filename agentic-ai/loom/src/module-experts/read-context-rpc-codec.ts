import type { UntrustedYamlMap, UntrustedYamlNode } from '../lib/guards.ts';

/** Owns admission of the external repository-context JSON-RPC envelope. */
export class RepositoryContextRpcSchema {
  private constructor() {}
  static decodeJsonRpcRequest(value: UntrustedYamlNode): JsonRpcRequest {
    if (!RepositoryContextRpcSchema.isTransportRecord(value)) return {};
    return {
      ...(typeof value.id === 'string' || typeof value.id === 'number'
        ? { id: value.id }
        : {}),
      ...(typeof value.jsonrpc === 'string' ? { jsonrpc: value.jsonrpc } : {}),
      ...(typeof value.method === 'string' ? { method: value.method } : {}),
      ...(Object.hasOwn(value, 'params')
        ? { params: RepositoryContextRpcSchema.decodeToolParams(value.params) }
        : {}),
    };
  }

  private static decodeToolParams(
    value: RepositoryContextTransportValue,
  ): ToolCallParams {
    if (
      !RepositoryContextRpcSchema.isTransportRecord(value) ||
      typeof value.name !== 'string' ||
      !RepositoryContextRpcSchema.isTransportRecord(value.arguments)
    )
      return {
        kind: ToolCallDecodeKind.Invalid,
        message: 'Invalid MCP tool call.',
      };
    const name = MODULE_EXPERT_READ_CONTEXT_TOOLS.find(
      (candidate) => candidate === value.name,
    );
    if (!name)
      return {
        kind: ToolCallDecodeKind.Invalid,
        message: 'Unsupported MCP tool.',
      };
    const args = value.arguments;
    const allowed =
      name === 'list_files'
        ? ['depth', 'path']
        : name === 'read_file'
          ? ['path']
          : ['path', 'query', 'maxResults'];
    if (Object.keys(args).some((key) => !allowed.includes(key)))
      return {
        kind: ToolCallDecodeKind.Invalid,
        message: 'Unexpected tool argument.',
      };
    const decoded: ToolArguments = {
      ...(typeof args.depth === 'number' ? { depth: args.depth } : {}),
      ...(typeof args.maxResults === 'number'
        ? { maxResults: args.maxResults }
        : {}),
      ...(typeof args.path === 'string' ? { path: args.path } : {}),
      ...(typeof args.query === 'string' ? { query: args.query } : {}),
    };
    return {
      kind: ToolCallDecodeKind.Valid,
      call: { name, arguments: decoded },
    };
  }

  private static isTransportRecord(
    value: RepositoryContextTransportValue,
  ): value is UntrustedYamlMap {
    return typeof value === 'object' && Boolean(value) && !Array.isArray(value);
  }
}

type RepositoryContextTransportValue = UntrustedYamlNode | void;

export type JsonRpcId = number | string;

export type ToolArguments = {
  readonly depth?: number;
  readonly maxResults?: number;
  readonly path?: string;
  readonly query?: string;
};

export enum ToolCallDecodeKind {
  Valid = 'valid',
  Invalid = 'invalid',
}

export type ToolCallParams =
  | { readonly kind: ToolCallDecodeKind.Valid; readonly call: ToolCallRequest }
  | { readonly kind: ToolCallDecodeKind.Invalid; readonly message: string };

export type JsonRpcRequest = {
  readonly id?: JsonRpcId;
  readonly jsonrpc?: string;
  readonly method?: string;
  readonly params?: ToolCallParams;
};

export type ToolCallRequest = {
  readonly arguments: ToolArguments;
  readonly name: RepositoryContextTool;
};
export const MODULE_EXPERT_READ_CONTEXT_TOOLS = [
  'list_files',
  'read_file',
  'search_text',
] as const;

export type RepositoryContextTool =
  (typeof MODULE_EXPERT_READ_CONTEXT_TOOLS)[number];
