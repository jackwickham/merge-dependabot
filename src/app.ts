import {Probot, ProbotOctokit} from "probot";
import {FactoryInstallationOptions} from "@octokit/auth-app/dist-types/types";
import type {components} from "@octokit/openapi-types";
import {Logger} from "pino";

type WithRepo = <T>(args: T) => T & {owner: string; repo: string};
type Octokit = InstanceType<typeof ProbotOctokit>;

interface Context {
  readonly octokit: Octokit;
  readonly withRepo: WithRepo;
  readonly log: Logger;
}

export default async function mergeApp(app: Probot): Promise<void> {
  app.on("check_suite.completed", async (context) => {
    for (const {number: prNumber} of context.payload.check_suite.pull_requests) {
      await checkPr(prNumber, {
        octokit: context.octokit,
        withRepo: (args) => context.repo(args),
        log: context.log,
      });
    }
  });

  await checkOpenPrs(await app.auth(), app.log);
}

async function checkOpenPrs(octokit: Octokit, log: Logger): Promise<void> {
  let installations;
  try {
    installations = await octokit.paginate(octokit.apps.listInstallations);
  } catch (e) {
    log.error(`Error listing installations: ${e}`);
    return;
  }
  for (const installation of installations) {
    let installationOctokit, repos;
    try {
      installationOctokit = (await octokit.auth({
        type: "installation",
        installationId: installation.id,
        factory: (options: FactoryInstallationOptions) => {
          return new ProbotOctokit({
            auth: options,
            octokitOptions: options.octokitOptions,
          });
        },
      })) as Octokit;
      repos = (await installationOctokit.paginate(
        installationOctokit.apps.listReposAccessibleToInstallation
      )) as unknown as components["schemas"]["repository"][];
    } catch (e) {
      log.error(`Error listing repos for user ${installation.account?.name}: ${e}`);
      continue;
    }

    for (const repo of repos) {
      let context: Context, prs;
      try {
        context = {
          octokit: installationOctokit,
          withRepo: <T>(args: T) => Object.assign({owner: repo.owner.login, repo: repo.name}, args),
          log: log.child({owner: repo.owner.login, repo: repo.name, trigger: "init"}),
        };

        prs = await context.octokit.paginate(
          context.octokit.pulls.list,
          context.withRepo<{state: "open"; sort: "created"}>({
            state: "open",
            sort: "created",
          })
        );
      } catch (e) {
        log.error(`Error listing PRs for ${repo.owner.login}/${repo.name}: ${e}`);
        continue;
      }
      for (const pr of prs) {
        await checkPr(pr.number, context);
      }
    }
  }
}

async function checkPr(prNumber: number, context: Context): Promise<void> {
  try {
    context.log.info(`Checking PR ${prNumber}`);
    const {data: pr} = await context.octokit.pulls.get(context.withRepo({pull_number: prNumber}));
    if (pr.user?.login !== "dependabot[bot]") {
      context.log.info(`PR ${prNumber} not authored by dependabot, skipping`);
      return;
    }
    const {data: checkStatus} = await context.octokit.checks.listForRef(
      context.withRepo({ref: pr.head.sha})
    );
    if (checkStatus.total_count === 0) {
      context.log.info("No checks on this commit, skipping");
      return;
    }
    if (checkStatus.total_count > checkStatus.check_runs.length) {
      context.log.warn(
        `Found fewer checks than total, skipping for safety (${checkStatus.total_count} > ${checkStatus.check_runs.length})`
      );
      return;
    }
    let anySuccess = false;
    for (const run of checkStatus.check_runs) {
      if (run.status === "completed" && run.conclusion === "success") {
        anySuccess = true;
      } else if (run.status === "completed" && run.conclusion === "skipped") {
        // No action required
      } else {
        context.log.info(
          `Check ${run.name} is currently ${run.status} (${run.conclusion}), skipping`
        );
        return;
      }
    }
    if (!anySuccess) {
      context.log.info(`All checks are currently skipped, skipping`);
      return;
    }

    if (!(await mergeability(pr, context))) {
      context.log.info(`PR ${prNumber} is not mergeable, skipping`);
      return;
    }

    const {data: commits} = await context.octokit.pulls.listCommits(
      context.withRepo({pull_number: prNumber})
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
      context.withRepo({
        pull_number: prNumber,
        sha: pr.head.sha,
        merge_method: "squash",
      })
    );
  } catch (e) {
    context.log.error(`Error processing PR ${prNumber}: ${e}`);
  }
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
    context.withRepo({pull_number: pr.number})
  );
  return mergeability(updatedPr, context, iteration + 1);
}
