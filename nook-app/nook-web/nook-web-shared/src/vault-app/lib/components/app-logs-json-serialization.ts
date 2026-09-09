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

export class AppLogsJsonDocument {
  constructor(private readonly document: AppLogsDocument) {}

  get text(): string {
    return JSON.stringify(this.document, AppLogsJsonDocument.preserveValue, 2);
  }

  static error(message: string): AppLogsJsonDocument {
    return new AppLogsJsonDocument({ error: message });
  }

  static loading(): AppLogsJsonDocument {
    return new AppLogsJsonDocument({ loading: true });
  }

  // JSON.stringify requires a two-argument host callback for its replacer.
  // eslint-disable-next-line max-params
  private static preserveValue(
    _key: string,
    value: JsonSerializationValue,
  ): JsonSerializationValue {
    return value;
  }
}
