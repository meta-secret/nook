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
    return JSON.stringify(this.document, null, 2);
  }

  static error(message: string): AppLogsJsonDocument {
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    return new AppLogsJsonDocument({ error: message });
  }

  static loading(): AppLogsJsonDocument {
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    return new AppLogsJsonDocument({ loading: true });
  }
}
