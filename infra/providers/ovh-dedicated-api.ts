import {
  ServerAdmissionKind,
  OvhServerAdmissionError,
  type OvhServerObservation,
} from "./ovh-dedicated-observations";
import { createHash } from "node:crypto";
import { OvhDocument } from "./ovh-dedicated-document";
import {
  HttpMethod,
  type ApiRequest,
  type OvhCredentials,
  type SignatureInput,
  type DedicatedServerDefinition,
  type CompatibleTemplates,
} from "./ovh-dedicated-contracts";
export class OvhDedicatedCreateOvhSignature {
  constructor(private readonly request: SignatureInput) {}
  execute(): string {
    const input = this.request;

    const material = [
      input.applicationSecret,
      input.consumerKey,
      input.method,
      input.url,
      input.body,
      input.timestamp,
    ].join("+");
    return `$1$${createHash("sha1").update(material).digest("hex")}`;
  }
}

export class OvhDedicatedApiRoot {
  constructor(private readonly request: OvhCredentials) {}
  execute(): string {
    const credentials = this.request;

    const roots: Record<string, string> = {
      "https://api.us.ovhcloud.com": "https://api.us.ovhcloud.com/1.0",
      "https://api.us.ovhcloud.com/1.0": "https://api.us.ovhcloud.com/1.0",
      "ovh-us": "https://api.us.ovhcloud.com/1.0",
    };
    const root = roots[credentials.endpoint];
    if (!root)
      throw new Error(
        "OVH credential endpoint is not an approved US API endpoint",
      );
    return root.endsWith("/1.0") ? root : `${root}/1.0`;
  }
}

export class OvhDedicatedOvhApi<T> {
  constructor(
    private readonly request: {
      credentials: OvhCredentials;
      request: ApiRequest;
      decode: (text: string) => T;
    },
  ) {}
  async execute(): Promise<T> {
    const input = this.request;

    const root = new OvhDedicatedApiRoot(input.credentials).execute();
    const { body = "" } = input.request;
    const url = `${root}${input.request.path}`;
    const timeResponse = await fetch(`${root}/auth/time`);
    if (!timeResponse.ok) throw new Error("OVH time endpoint failed");
    const timestamp = Number(await timeResponse.text());
    const signatureInput: SignatureInput = {
      applicationSecret: input.credentials.applicationSecret,
      body,
      consumerKey: input.credentials.consumerKey,
      method: input.request.method,
      timestamp,
      url,
    };
    const headers = new Headers({
      "Content-Type": "application/json",
      "X-Ovh-Application": input.credentials.applicationKey,
      "X-Ovh-Consumer": input.credentials.consumerKey,
      "X-Ovh-Signature": new OvhDedicatedCreateOvhSignature(
        signatureInput,
      ).execute(),
      "X-Ovh-Timestamp": String(timestamp),
    });
    const options: RequestInit = {
      headers,
      method: input.request.method,
    };
    if (input.request.method === HttpMethod.Post) options.body = body;
    const response = await fetch(url, options);
    const responseBody = await response.text();
    if (!response.ok) {
      throw new Error(
        `OVH API ${input.request.method} ${input.request.path} failed: HTTP_${response.status}`,
      );
    }
    return input.decode(responseBody);
  }
}

export class OvhDedicatedGetServer {
  constructor(
    private readonly request: {
      credentials: OvhCredentials;
      definition: DedicatedServerDefinition;
    },
  ) {}
  async execute(): Promise<OvhServerObservation> {
    const input = this.request;

    const request: ApiRequest = {
      method: HttpMethod.Get,
      path: `/dedicated/server/${encodeURIComponent(input.definition.serviceName)}`,
    };
    const server = await new OvhDedicatedOvhApi({
      decode: OvhDocument.server,
      credentials: input.credentials,
      request,
    }).execute();
    const admission = server.admission(input.definition);
    if (admission.kind === ServerAdmissionKind.Incompatible)
      throw new OvhServerAdmissionError();
    return admission.server;
  }
}

export class OvhDedicatedRequireCompatibleTemplate {
  constructor(
    private readonly request: {
      credentials: OvhCredentials;
      definition: DedicatedServerDefinition;
    },
  ) {}
  async execute(): Promise<void> {
    const input = this.request;

    const request: ApiRequest = {
      method: HttpMethod.Get,
      path: `/dedicated/server/${encodeURIComponent(input.definition.serviceName)}/install/compatibleTemplates`,
    };
    const templates = await new OvhDedicatedOvhApi({
      decode: OvhDocument.compatibleTemplates,
      credentials: input.credentials,
      request,
    }).execute();
    if (!templates.ovh.includes(input.definition.operatingSystem)) {
      throw new Error(
        "declared operating system is not compatible with this server",
      );
    }
  }
}
