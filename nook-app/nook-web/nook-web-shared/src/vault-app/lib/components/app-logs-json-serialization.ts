import type { AppLogsResponse } from "$lib/app/logs-api";

type AppLogsErrorDocument = {
  readonly error: string;
};

type AppLogsLoadingDocument = {
  readonly loading: true;
};

type AppLogsDocument =
  AppLogsResponse | AppLogsErrorDocument | AppLogsLoadingDocument;

type AppLogsJsonValue =
  | AppLogsDocument
  | AppLogsResponse["meta"]
  | AppLogsResponse["entries"]
  | AppLogsResponse["entries"][number]
  | string
  | number
  | boolean;

type AppLogsJsonReplacerArguments = readonly [
  key: string,
  value: AppLogsJsonValue,
];

type AppLogsJsonReplacer = (
  ...args: AppLogsJsonReplacerArguments
) => AppLogsJsonValue;

const preserveAppLogsJsonValue: AppLogsJsonReplacer = (...args) => args[1];

export class AppLogsJsonDocument {
  constructor(private readonly document: AppLogsDocument) {}

  get text(): string {
    return JSON.stringify(this.document, preserveAppLogsJsonValue, 2);
  }

  static error(message: string): AppLogsJsonDocument {
    return new AppLogsJsonDocument({ error: message });
  }

  static loading(): AppLogsJsonDocument {
    return new AppLogsJsonDocument({ loading: true });
  }
}
