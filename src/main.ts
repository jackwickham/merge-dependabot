import * as core from "@actions/core";
import * as github from "@actions/github";

const COMMENT = "@dependabot squash and merge";

async function run(): Promise<void> {
  try {
    if (!github.context.payload.pull_request) {
      core.info("Not a pull request, skipping");
      return;
    }

    const token = core.getInput("github_token", {required: true});
    const octokit = github.getOctokit(token);

    const pr = await octokit.pulls.get({
      owner: github.context.issue.owner,
      repo: github.context.issue.repo,
      pull_number: github.context.issue.number,
    });
    if (pr.data.user?.login !== "dependabot[bot]") {
      core.info(`${pr.data.user?.login} is not dependabot, skipping`);
    }

    const comments = await octokit.issues.listComments({
      owner: github.context.issue.owner,
      repo: github.context.issue.repo,
      issue_number: github.context.issue.number,
    });
    for (const comment of comments.data) {
      if (comment.body === COMMENT) {
        core.info("Comment has already been added, skipping");
        return;
      }
    }

    core.info("Adding comment");
    await octokit.issues.createComment({
      owner: github.context.issue.owner,
      repo: github.context.issue.repo,
      issue_number: github.context.issue.number,
      body: COMMENT,
    });
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
