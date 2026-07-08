const REQUIRED_ENV = [
  "GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO", "GITHUB_DEFAULT_BRANCH",
  "GITHUB_AUTHOR_NAME", "GITHUB_AUTHOR_EMAIL",
];

const ALLOWED_PATHS = [
  "src/content/artifacts/",
  "src/content/decision-resolutions/",
  "src/content/change-log/",
  "src/content/rewrite-requests/",
  "src/content/revert-requests/",
  "src/content/operation-policies/",
  "patches/",
];

export const githubConfigStatus = (env = process.env) => {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  return { configured: missing.length === 0, missing };
};

export const assertAllowedWritePath = (filePath) => {
  if (typeof filePath !== "string" || !filePath || filePath.includes("\\") || filePath.includes("..") || filePath.startsWith("/")) {
    throw new Error(`Unsafe write path: ${String(filePath)}`);
  }
  if (!ALLOWED_PATHS.some((prefix) => filePath.startsWith(prefix))) {
    throw new Error(`Write path is outside the allowlist: ${filePath}`);
  }
  return filePath;
};

const encodeBranch = (branch) => branch.split("/").map(encodeURIComponent).join("/");

export class GitHubAdapter {
  constructor({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    const status = githubConfigStatus(env);
    if (!status.configured) throw new Error(`GitHub writeback is not configured. Missing: ${status.missing.join(", ")}`);
    this.config = {
      token: env.GITHUB_TOKEN,
      owner: env.GITHUB_OWNER,
      repo: env.GITHUB_REPO,
      defaultBranch: env.GITHUB_DEFAULT_BRANCH,
      authorName: env.GITHUB_AUTHOR_NAME,
      authorEmail: env.GITHUB_AUTHOR_EMAIL,
    };
    this.fetch = fetchImpl;
    this.baseUrl = `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}`;
  }

  async request(path, options = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.config.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        ...options.headers,
      },
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); }
      catch {
        const error = new Error(`GitHub API ${response.status} returned a non-JSON response`);
        error.status = response.status;
        throw error;
      }
    }
    if (!response.ok) {
      const error = new Error(`GitHub API ${response.status}: ${body?.message || response.statusText}`);
      error.status = response.status;
      error.details = body;
      throw error;
    }
    return body;
  }

  async getDefaultBranchState() {
    const ref = await this.request(`/git/ref/heads/${encodeBranch(this.config.defaultBranch)}`);
    if (!ref?.object?.sha) throw new Error(`GitHub default branch response for ${this.config.defaultBranch} did not include object.sha`);
    const commit = await this.request(`/git/commits/${ref.object.sha}`);
    if (!commit?.tree?.sha) throw new Error("GitHub commit response did not include tree.sha");
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
  }

  async getBranchState(branch) {
    const ref = await this.request(`/git/ref/heads/${encodeBranch(branch)}`);
    if (!ref?.object?.sha) throw new Error(`GitHub branch response for ${branch} did not include object.sha`);
    const commit = await this.request(`/git/commits/${ref.object.sha}`);
    if (!commit?.tree?.sha) throw new Error("GitHub commit response did not include tree.sha");
    return { commitSha:ref.object.sha, treeSha:commit.tree.sha };
  }

  async readJson(filePath, ref = this.config.defaultBranch) {
    assertAllowedWritePath(filePath);
    try {
      const file = await this.request(`/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`);
      const source = Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
      return { data: JSON.parse(source), sha: file.sha };
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async createBranch(branch, sha) {
    await this.request("/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) });
  }

  async commitFiles({ branch, parentSha, baseTreeSha, files, message }) {
    const tree = [];
    for (const file of files) {
      assertAllowedWritePath(file.path);
      const blob = await this.request("/git/blobs", { method: "POST", body: JSON.stringify({ content: file.content, encoding: "utf-8" }) });
      tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const nextTree = await this.request("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: baseTreeSha, tree }) });
    const commit = await this.request("/git/commits", {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: nextTree.sha,
        parents: [parentSha],
        author: { name: this.config.authorName, email: this.config.authorEmail },
      }),
    });
    await this.request(`/git/refs/heads/${encodeBranch(branch)}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
    return { commitSha: commit.sha, treeSha: nextTree.sha };
  }

  async openPullRequest({ branch, title, body, draft = true }) {
    const pullRequest = await this.request("/pulls", {
      method: "POST",
      body: JSON.stringify({ title, body, head: branch, base: this.config.defaultBranch, draft, maintainer_can_modify: true }),
    });
    if (!pullRequest?.html_url || !pullRequest?.number) throw new Error("GitHub pull request response did not include html_url and number");
    return pullRequest;
  }

  async mergePullRequest({ number, expectedHeadSha }) {
    return this.request(`/pulls/${number}/merge`, {
      method: "PUT",
      body: JSON.stringify({ sha: expectedHeadSha, merge_method: "squash", commit_title: `Creative OS operation #${number}` }),
    });
  }

  async listOperationReviews() {
    const pulls = await this.request("/pulls?state=all&sort=updated&direction=desc&per_page=50");
    const operations = pulls.filter((pull) => pull.head?.ref?.startsWith("creative-os/") || pull.title?.includes("[Creative OS"));
    return Promise.all(operations.map(async (pull) => {
      let audit = null;
      let reviewAudit = null;
      try {
        const files = await this.request(`/pulls/${pull.number}/files?per_page=100`);
        const auditFiles = files.filter((file) => file.filename?.startsWith("src/content/change-log/") && file.filename.endsWith(".json")).sort((a,b)=>a.filename.localeCompare(b.filename));
        const originalFile = auditFiles.find((file)=>!file.filename.includes("-review-")) || auditFiles[0];
        const reviewFile = auditFiles.filter((file)=>file.filename.includes("-review-")).at(-1);
        if (originalFile) audit = (await this.readJson(originalFile.filename, pull.head.ref))?.data || null;
        if (reviewFile) reviewAudit = (await this.readJson(reviewFile.filename, pull.head.ref))?.data || null;
      } catch { /* PR metadata remains useful even if an audit file cannot be read. */ }
      return {
        pullRequestNumber:pull.number, pullRequestUrl:pull.html_url, title:pull.title, state:pull.state, draft:Boolean(pull.draft),
        merged:Boolean(pull.merged_at), createdAt:pull.created_at, updatedAt:pull.updated_at, branchName:pull.head?.ref,
        submitter:pull.user?.login || null, audit, reviewAudit,
      };
    }));
  }

  async getPullRequest(number) {
    return this.request(`/pulls/${number}`);
  }

  async addPullRequestComment(number, body) {
    return this.request(`/issues/${number}/comments`, { method:"POST", body:JSON.stringify({ body }) });
  }

  async closePullRequest(number) {
    return this.request(`/pulls/${number}`, { method:"PATCH", body:JSON.stringify({ state:"closed" }) });
  }

  async reopenPullRequest(number) {
    return this.request(`/pulls/${number}`, { method:"PATCH", body:JSON.stringify({ state:"open" }) });
  }

  async appendFilesToBranch({ branch, files, message }) {
    const state = await this.getBranchState(branch);
    return this.commitFiles({ branch, parentSha:state.commitSha, baseTreeSha:state.treeSha, files, message });
  }

  async stageOperation({ operationId, title, body, files, finalizeFiles, draft = true }) {
    const progress = { githubWriteAttempted: true, branchCreated: false, commitCreated: false, prCreated: false };
    try {
    files.forEach((file) => assertAllowedWritePath(file.path));
    const base = await this.getDefaultBranchState();
    const branch = `creative-os/${operationId}`.slice(0, 240);
    await this.createBranch(branch, base.commitSha);
    progress.branchCreated = true;
    const initial = await this.commitFiles({ branch, parentSha: base.commitSha, baseTreeSha: base.treeSha, files, message: title });
    progress.commitCreated = true;
    const pullRequest = await this.openPullRequest({ branch, title, body, draft });
    progress.prCreated = true;
    let finalCommit = initial;
    if (finalizeFiles) {
      const finalized = finalizeFiles(pullRequest.html_url, initial.commitSha);
      finalized.forEach((file) => assertAllowedWritePath(file.path));
      finalCommit = await this.commitFiles({
        branch,
        parentSha: initial.commitSha,
        baseTreeSha: initial.treeSha,
        files: finalized,
        message: `Record PR link for ${operationId}`,
      });
    }
    return {
      branch,
      commitSha: finalCommit.commitSha,
      pullRequestUrl: pullRequest.html_url,
      pullRequestNumber: pullRequest.number,
      pullRequestStatus: pullRequest.draft ? "draft" : "open",
      changedFiles: files.map((file) => file.path),
      progress,
    };
    } catch (error) {
      error.githubProgress = progress;
      throw error;
    }
  }
}
