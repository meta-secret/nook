export class JsonDocument {
  constructor(private readonly request: unknown) {}
  format(): string {
    const value = this.request;

    return JSON.stringify(value, (_key, nestedValue) => nestedValue, 2);
  }
}
