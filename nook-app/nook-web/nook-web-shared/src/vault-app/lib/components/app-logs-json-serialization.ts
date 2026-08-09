import type { AppLogsResponse } from "$lib/app/logs-api";

type AppLogsErrorDocument = {
  readonly error: string;
};

type AppLogsLoadingDocument = {
  readonly loading: true;
};

type AppLogsDocument =
  AppLogsResponse | AppLogsErrorDocument | AppLogsLoadingDocument;

type JsonSerializationValue =
  | string
  | number
  | boolean
  | readonly JsonSerializationValue[]
  | { readonly [key: string]: JsonSerializationValue };

// JSON.stringify is a host adapter whose replacer necessarily receives every
// JSON transport value. Keep that generic boundary here and return immediately.
// eslint-disable-next-line max-params
function preserveJsonSerializationValue(
  _key: string,
  value: JsonSerializationValue,
): JsonSerializationValue {
  return value;
}

function formatAppLogsDocument(document: AppLogsDocument): string {
  return JSON.stringify(document, preserveJsonSerializationValue, 2);
}

export function formatAppLogsError(message: string): string {
  const document: AppLogsErrorDocument = { error: message };
  return formatAppLogsDocument(document);
}

export function formatAppLogsPayload(payload: AppLogsResponse): string {
  return formatAppLogsDocument(payload);
}

export function formatAppLogsLoading(): string {
  const document: AppLogsLoadingDocument = { loading: true };
  return formatAppLogsDocument(document);
}
