import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

type PreviewComment = z.infer<typeof previewCommentsSchema>[number];
enum PreviewFailureKind {
  Configuration = "configuration",
  Network = "network",
  Http = "http",
  Response = "response",
  Schema = "schema",
}
interface PreviewFailure {
  kind: PreviewFailureKind;
  message: string;
}
interface PreviewConfiguration {
  token: string;
  repository: string;
  issueNumber: number;
  previewUrl: string;
}

class PreviewEnvironment {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  admit(): Result<PreviewConfiguration, PreviewFailure> {
    const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository,
      PR_NUMBER: prNumber, PREVIEW_URL: previewUrl } = this.environment;
    if (!token || !repository || !prNumber || !previewUrl)
      return err({ kind: PreviewFailureKind.Configuration,
        message: "Missing GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, or PREVIEW_URL" });
    const issueNumber = Number(prNumber);
    if (!/^[^/]+\/[^/]+$/.test(repository) || !Number.isSafeInteger(issueNumber) || issueNumber < 1)
      return err({ kind: PreviewFailureKind.Configuration, message: "Invalid repository or pull-request number" });
    return ok({ token, repository, issueNumber, previewUrl });
  }
}

const previewCommentsSchema = z.array(
  z.object({
    id: z.number().refine(Number.isSafeInteger),
    body: z.string(),
  }),
);

class PreviewCommentsResponse {
  constructor(private readonly response: Response) {}
  async admit(): Promise<Result<PreviewComment[], PreviewFailure>> {
    if (!this.response.ok)
      return err({
        kind: PreviewFailureKind.Http,
        message: `GitHub API request failed (${this.response.status})`,
      });
    let value: unknown;
    try {
      value = await this.response.json();
    } catch {
      return err({
        kind: PreviewFailureKind.Response,
        message: "Unable to decode GitHub comments response",
      });
    }
    const parsed = previewCommentsSchema.safeParse(value);
    return parsed.success
      ? ok(parsed.data)
      : err({
          kind: PreviewFailureKind.Schema,
          message: "GitHub comments response has an invalid schema",
        });
  }
}

enum PreviewRequestMethod { Read = "GET", Update = "PATCH", Create = "POST" }
interface PreviewRequest {
  path: string;
  method: PreviewRequestMethod;
}
class PreviewCommentPublication {
  constructor(private readonly configuration: PreviewConfiguration) {}
  private async request(request: PreviewRequest): Promise<Result<Response, PreviewFailure>> {
    const init: RequestInit = {
      method: request.method,
      headers: {
        Authorization: `Bearer ${this.configuration.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
    };
    if (request.method !== PreviewRequestMethod.Read)
      init.body = JSON.stringify({ body: `### Preview deployed\n\n${this.configuration.previewUrl}` });
    try {
      return ok(await fetch(`https://api.github.com/repos/${this.configuration.repository}/${request.path}`, init));
    } catch {
      return err({ kind: PreviewFailureKind.Network, message: "GitHub preview comment request failed" });
    }
  }
  async execute(): Promise<Result<void, PreviewFailure>> {
    const listed = await this.request({ path: `issues/${this.configuration.issueNumber}/comments`, method: PreviewRequestMethod.Read });
    if (listed.isErr()) return err(listed.error);
    const comments = await new PreviewCommentsResponse(listed.value).admit();
    if (comments.isErr()) return err(comments.error);
    const existing = comments.value.find((comment) => comment.body.startsWith("### Preview deployed"));
    const published = await this.request(existing
      ? { path: `issues/comments/${existing.id}`, method: PreviewRequestMethod.Update }
      : { path: `issues/${this.configuration.issueNumber}/comments`, method: PreviewRequestMethod.Create });
    if (published.isErr()) return err(published.error);
    if (!published.value.ok)
      return err({ kind: PreviewFailureKind.Http, message: `GitHub API request failed (${published.value.status})` });
    try { await published.value.text(); }
    catch { return err({ kind: PreviewFailureKind.Response, message: "Unable to read GitHub comment publication response" }); }
    return ok();
  }
}

const configuration = new PreviewEnvironment(process.env).admit();
const outcome = configuration.isErr() ? err<void, PreviewFailure>(configuration.error)
  : await new PreviewCommentPublication(configuration.value).execute();
if (outcome.isErr()) {
  console.error(outcome.error.message);
  process.exitCode = 1;
}
