import { ServerAdmissionKind, type OvhServerObservation } from "./ovh-dedicated-observations";
import { createHash } from "node:crypto";
import { err, ok, type Result } from "neverthrow";
import { OvhFailure, OvhFailureKind } from "./ovh-dedicated-failure";
import { OvhDocument } from "./ovh-dedicated-document";
import { HttpMethod, type ApiRequest, type OvhCredentials, type SignatureInput,
  type DedicatedServerDefinition } from "./ovh-dedicated-contracts";

export class OvhDedicatedCreateOvhSignature {
  constructor(private readonly request: SignatureInput) {}
  execute(): string {
    const input = this.request;
    const material = [input.applicationSecret, input.consumerKey, input.method,
      input.url, input.body, input.timestamp].join("+");
    return `$1$${createHash("sha1").update(material).digest("hex")}`;
  }
}
export class OvhEndpoint {
  constructor(private readonly value: string) {}
  apiRoot(): Result<string, OvhFailure> {
    switch (this.value) {
      case "https://api.us.ovhcloud.com":
      case "https://api.us.ovhcloud.com/1.0":
      case "ovh-us": return ok("https://api.us.ovhcloud.com/1.0");
      default: return err(new OvhFailure(OvhFailureKind.Endpoint,
        "OVH credential endpoint is not an approved US API endpoint"));
    }
  }
}
class OvhHttpRequest {
  constructor(private readonly url: string) {}
  async send(options: RequestInit): Promise<Result<string, OvhFailure>> {
    let response: Response;
    try { response = await fetch(this.url, options); }
    catch { return err(new OvhFailure(OvhFailureKind.Network, "OVH API request failed")); }
    if (!response.ok) return err(new OvhFailure(OvhFailureKind.Http, `OVH API request failed: HTTP_${response.status}`));
    try { return ok(await response.text()); }
    catch { return err(new OvhFailure(OvhFailureKind.Network, "Unable to read OVH API response")); }
  }
}
export class OvhDedicatedOvhApi<T> {
  constructor(private readonly request: {
    credentials: OvhCredentials; request: ApiRequest; decode: (text: string) => Result<T, OvhFailure>;
  }) {}
  async execute(): Promise<Result<T, OvhFailure>> {
    const input = this.request;
    const root = new OvhEndpoint(input.credentials.endpoint).apiRoot();
    if (root.isErr()) return err(root.error);
    const { body = "" } = input.request;
    const url = `${root.value}${input.request.path}`;
    const time = await new OvhHttpRequest(`${root.value}/auth/time`).send({ method: HttpMethod.Get });
    if (time.isErr()) return err(time.error);
    const timestamp = Number(time.value);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0)
      return err(new OvhFailure(OvhFailureKind.Schema, "OVH time endpoint returned an invalid timestamp"));
    const signatureInput: SignatureInput = {
      applicationSecret: input.credentials.applicationSecret, body,
      consumerKey: input.credentials.consumerKey, method: input.request.method, timestamp, url,
    };
    const options: RequestInit = {
      headers: {
        "Content-Type": "application/json", "X-Ovh-Application": input.credentials.applicationKey,
        "X-Ovh-Consumer": input.credentials.consumerKey,
        "X-Ovh-Signature": new OvhDedicatedCreateOvhSignature(signatureInput).execute(),
        "X-Ovh-Timestamp": String(timestamp),
      }, method: input.request.method,
    };
    if (input.request.method === HttpMethod.Post) options.body = body;
    const response = await new OvhHttpRequest(url).send(options);
    if (response.isErr()) return err(response.error);
    return input.decode(response.value);
  }
}
export class OvhDedicatedGetServer {
  constructor(private readonly request: { credentials: OvhCredentials; definition: DedicatedServerDefinition }) {}
  async execute(): Promise<Result<OvhServerObservation, OvhFailure>> {
    const server = await new OvhDedicatedOvhApi({
      decode: (text) => new OvhDocument(text).server(), credentials: this.request.credentials,
      request: { method: HttpMethod.Get,
        path: `/dedicated/server/${encodeURIComponent(this.request.definition.serviceName)}` },
    }).execute();
    if (server.isErr()) return err(server.error);
    const admission = server.value.admission(this.request.definition);
    if (admission.kind === ServerAdmissionKind.Incompatible)
      return err(new OvhFailure(OvhFailureKind.Identity, "OVH server does not match the declared identity and ready-state contract"));
    return ok(admission.server);
  }
}
export class OvhDedicatedRequireCompatibleTemplate {
  constructor(private readonly request: { credentials: OvhCredentials; definition: DedicatedServerDefinition }) {}
  async execute(): Promise<Result<void, OvhFailure>> {
    const templates = await new OvhDedicatedOvhApi({
      decode: (text) => new OvhDocument(text).compatibleTemplates(), credentials: this.request.credentials,
      request: { method: HttpMethod.Get,
        path: `/dedicated/server/${encodeURIComponent(this.request.definition.serviceName)}/install/compatibleTemplates` },
    }).execute();
    if (templates.isErr()) return err(templates.error);
    if (!templates.value.ovh.includes(this.request.definition.operatingSystem))
      return err(new OvhFailure(OvhFailureKind.Template, "declared operating system is not compatible with this server"));
    return ok();
  }
}
