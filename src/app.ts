import {Probot, Context} from "probot";

export default async function mergeApp(app: Probot): Promise<void> {
  app.on("check_suite.completed", async (context) => {
    const {data: status} = await context.octokit.checks.listForRef(
      context.repo({
        ref: context.payload.check_suite.head_sha,
      })
    );
    if (status.total_count === 0) {
      context.log.info("No checks on this commit, skipping");
      return;
    }
    if (status.total_count > status.check_runs.length) {
      context.log.warn(
        `Found fewer checks than total, skipping for safety (${status.total_count} > ${status.check_runs.length})`
      );
    }
    for (const run of status.check_runs) {
      if (run.status !== "completed" || run.conclusion !== "success") {
        context.log.info(
          `Check ${run.name} is currently ${run.status} (${run.conclusion}), skipping`
        );
        return;
      }
    }

    for (const {number: prNumber} of context.payload.check_suite.pull_requests) {
      const {data: pr} = await context.octokit.pulls.get(
        context.pullRequest({pull_number: prNumber})
      );
      if (pr.user?.login !== "dependabot[bot]") {
        context.log.info(`PR ${prNumber} not authored by dependabot, skipping`);
        return;
      }
      if (pr.head.sha !== context.payload.check_suite.head_sha) {
        context.log.info(
          `Head SHA of PR ${prNumber} is no longer ${context.payload.check_suite.head_sha}, skipping`
        );
        return;
      }
      if (!(await mergeability(pr, context))) {
        context.log.info(`PR ${prNumber} is not mergeable, skipping`);
        return;
      }

      const {data: commits} = await context.octokit.pulls.listCommits(
        context.pullRequest({pull_number: prNumber})
      );
      for (const commit of commits) {
        if (commit.author?.login !== "dependabot[bot]") {
          context.log.info(
            `Commit ${commit.sha} on PR ${prNumber} not authored by dependabot, skipping`
          );
          return;
        }
      }

      context.log.info(`Merging ${prNumber}`);
      await context.octokit.pulls.merge(
        context.pullRequest({
          pull_number: prNumber,
          sha: context.payload.check_suite.head_sha,
          merge_method: "squash",
        })
      );
    }
  });
}

async function mergeability(
  pr: {mergeable: boolean | null; number: number},
  context: Context,
  iteration = 1
): Promise<boolean> {
  if (pr.mergeable !== null) {
    return pr.mergeable;
  }

  if (iteration > 4) {
    context.log.warn("PR mergeability not available after 5 iterations");
    return false;
  }

  await new Promise((resolve) => setTimeout(resolve, 10000));

  const {data: updatedPr} = await context.octokit.pulls.get(
    context.pullRequest({pull_number: pr.number})
  );
  return mergeability(updatedPr, context, iteration + 1);
}
