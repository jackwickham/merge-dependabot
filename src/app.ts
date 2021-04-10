import {Probot} from "probot";

const COMMENT = "@dependabot squash and merge";

export default async function mergeApp(app: Probot): Promise<void> {
  app.on("pull_request.opened", async (context) => {
    if (context.payload.pull_request.user.login !== "dependabot[bot]") {
      context.log.info("Not a dependabot PR, skipping");
      return;
    }

    context.log.info("Adding comment");
    await context.octokit.issues.createComment(context.issue({body: COMMENT}));
  });
}
