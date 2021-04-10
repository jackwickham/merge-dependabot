import {Probot} from "probot";

export default async function mergeApp(app: Probot): Promise<void> {
  app.on("check_suite.completed", async (context) => {
    const {data: status} = await context.octokit.repos.getCombinedStatusForRef(
      context.repo({
        ref: context.payload.check_suite.head_sha,
      })
    );
    if (status.state !== "success") {
      context.log.info("Commit status is not success, skipping");
      return;
    }
    if (status.total_count === 0) {
      context.log.info("No checks on this commit, skipping");
      return;
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
      if (!pr.mergeable) {
        context.log.info(`PR ${prNumber} is not mergeable, skipping`);
        return;
      }

      context.log.info(`Merging ${prNumber}`);
      await context.octokit.pulls.merge(context.pullRequest({pull_number: prNumber}));
    }
  });
}
