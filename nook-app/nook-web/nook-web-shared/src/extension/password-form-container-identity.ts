/** Collects DOM identity text; authentication policy belongs to Rust. */
export class AuthenticationContainerIdentity {
  constructor(private readonly request: Element) {}
  // Form controls named id/className shadow reflected DOM properties.
  // Read the authored attributes without consulting the form's named controls.
  private attribute(name: string): string {
    const value = this.request.getAttribute(name);
    switch (typeof value === "string") {
      case true:
        return value;
      case false:
        return "";
    }
  }
  get id(): string {
    return this.attribute("id");
  }
  get className(): string {
    return this.attribute("class");
  }
  get text(): string {
    return [this.id, this.className].filter(Boolean).join(" ");
  }
}
