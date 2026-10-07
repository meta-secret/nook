/** Collects DOM identity text; authentication policy belongs to Rust. */
export class AuthenticationContainerIdentity {
  constructor(private readonly request: Element) {}
  get text(): string {
    return [this.request.id, this.request.getAttribute("class")]
      .filter(Boolean)
      .join(" ");
  }
}
