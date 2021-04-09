import * as core from "@actions/core";
import * as github from "@actions/github";

const COMMENT = "@dependabot squash and merge";

async function run(): Promise<void> {
  try {
    if (github.context.actor !== "dependabot[bot]") {
      core.info(`${github.context.actor} isn't dependabot, skipping`);
      return;
    }
    if (!github.context.payload.pull_request) {
      core.info("Not a pull request, skipping");
      return;
    }

    const token = core.getInput("github_token", {required: true});
    const octokit = github.getOctokit(token);
    const prContext = {
      owner: github.context.issue.owner,
      repo: github.context.issue.repo,
      issue_number: github.context.issue.number, // eslint-disable-line @typescript-eslint/naming-convention
    };

    const comments = await octokit.issues.listComments(prContext);
    for (const comment of comments.data) {
      if (comment.body === COMMENT) {
        core.info("Comment has already been added, skipping");
        return;
      }
    }

    core.info("Adding comment");
    await octokit.issues.createComment({
      ...prContext,
      body: COMMENT,
    });
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
