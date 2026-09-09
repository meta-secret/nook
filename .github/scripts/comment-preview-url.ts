interface PreviewComment {
  id: number;
  body: string;
}
class CommentPreviewUrlExpectJson {
  private static isComment(value: unknown): value is PreviewComment {
    return (
      typeof value === "object" &&
      !!value &&
      "id" in value &&
      typeof value.id === "number" &&
      Number.isSafeInteger(value.id) &&
      "body" in value &&
      typeof value.body === "string"
    );
  }
  constructor(private readonly request: Response) {}
  async execute(): Promise<PreviewComment[]> {
    const response = this.request;

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `GitHub API request failed (${response.status}): ${text}`,
      );
    }
    const value: unknown = JSON.parse(text);
    if (
      !Array.isArray(value) ||
      !value.every(CommentPreviewUrlExpectJson.isComment)
    )
      throw new Error("GitHub comments response has an invalid schema");
    return value;
  }
}

class CommentPreviewUrlExpectOk {
  constructor(private readonly request: Response) {}
  async execute(): Promise<void> {
    const response = this.request;

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `GitHub API request failed (${response.status}): ${text}`,
      );
    }
  }
}
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;
const previewUrl = process.env.PREVIEW_URL;

if (!token || !repository || !prNumber || !previewUrl) {
  throw new Error(
    "Missing GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, or PREVIEW_URL",
  );
}

const [owner, repo] = repository.split("/");
const issue_number = Number(prNumber);

const url = previewUrl;
const body = `### Preview deployed\n\n${url}`;

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

const listComments = () =>
  fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/comments`,
    { headers },
  ).then((response) => new CommentPreviewUrlExpectJson(response).execute());

const updateComment = (comment_id: number) =>
  fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/comments/${comment_id}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ body }),
    },
  ).then((response) => new CommentPreviewUrlExpectOk(response).execute());

const createComment = () =>
  fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/comments`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ body }),
    },
  ).then((response) => new CommentPreviewUrlExpectOk(response).execute());

const comments = await listComments();
const existing = comments.find((c) =>
  c.body.startsWith("### Preview deployed"),
);

if (existing) {
  await updateComment(existing.id);
} else {
  await createComment();
}
