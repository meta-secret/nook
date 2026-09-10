import type { AppLogsResponse } from "$lib/app/logs-api";

type AppLogsErrorDocument = {
  readonly error: string;
};

type AppLogsLoadingDocument = {
  readonly loading: true;
};

type AppLogsDocument =
  AppLogsResponse | AppLogsErrorDocument | AppLogsLoadingDocument;

export class AppLogsJsonDocument {
  constructor(private readonly document: AppLogsDocument) {}

  get text(): string {
    return JSON.stringify(this.document, (_key, value) => value, 2);
  }

  static error(message: string): AppLogsJsonDocument {
    return new AppLogsJsonDocument({ error: message });
  }

  static loading(): AppLogsJsonDocument {
    return new AppLogsJsonDocument({ loading: true });
  }
}
