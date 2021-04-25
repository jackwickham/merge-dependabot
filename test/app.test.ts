import {Probot, ProbotOctokit} from "probot";
import {WebhookEvent, EventPayloads} from "@octokit/webhooks";
import {RestEndpointMethodTypes} from "@octokit/plugin-rest-endpoint-methods";
import {promises as fs} from "fs";
import path from "path";
import nock from "nock";
import {setImmediate as builtinSetImmediate} from "timers";
import mergeApp from "../src/app";

describe("app", () => {
  let probot: Probot;
  let webhook: WebhookEvent<EventPayloads.WebhookPayloadCheckSuite>;
  let checks: RestEndpointMethodTypes["checks"]["listForRef"]["response"]["data"];
  let pullRequest: RestEndpointMethodTypes["pulls"]["get"]["response"]["data"];
  let prCommits: RestEndpointMethodTypes["pulls"]["listCommits"]["response"]["data"];

  let cancelAdvanceTimers: () => void;

  jest.useFakeTimers();

  beforeEach(async () => {
    nock.disableNetConnect();
    nock.cleanAll();

    probot = new Probot({
      githubToken: "test",
      Octokit: ProbotOctokit.defaults({
        retry: {enabled: false},
        throttle: {enabled: false},
      }),
    });
    mergeApp(probot);

    webhook = await loadFixture("webhooks/check_suite_completed.json");
    checks = await loadFixture("responses/check_runs.json");
    pullRequest = await loadFixture("responses/pull_request.json");
    prCommits = await loadFixture("responses/pr_commits.json");

    cancelAdvanceTimers = advanceTimersInBackground();

    jest.setTimeout(100000);
  });

  afterEach(() => {
    cancelAdvanceTimers();
    expect(nock.pendingMocks()).toEqual([]);
    expect(nock.isDone()).toBe(true);
  });

  test("does nothing when check in progress", async () => {
    checks.check_runs[0].status = "in_progress";
    nock("https://api.github.com")
      .get(
        "/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/check-runs"
      )
      .reply(200, checks);
    await probot.receive(webhook);
  });

  test("does nothing when check failed", async () => {
    checks.check_runs[0].conclusion = "failure";
    nock("https://api.github.com")
      .get(
        "/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/check-runs"
      )
      .reply(200, checks);
    await probot.receive(webhook);
  });

  test("does nothing when no checks", async () => {
    checks.total_count = 0;
    checks.check_runs = [];
    nock("https://api.github.com")
      .get(
        "/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/check-runs"
      )
      .reply(200, checks);
    await probot.receive(webhook);
  });

  test("does nothing when PR not created by dependabot", async () => {
    nock("https://api.github.com")
      .get(
        "/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/check-runs"
      )
      .reply(200, checks);
    pullRequest.user!.login = "not-dependabot";
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, pullRequest);
    await probot.receive(webhook);
  });

  test("does nothing when PR head has changed", async () => {
    nock("https://api.github.com")
      .get(
        "/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/check-runs"
      )
      .reply(200, checks);
    pullRequest.head.sha = "ffff";
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, pullRequest);
    await probot.receive(webhook);
  });

  test("does nothing when PR not mergeable", async () => {
    nock("https://api.github.com")
      .get(
        "/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/check-runs"
      )
      .reply(200, checks);
    pullRequest.mergeable = false;
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, pullRequest);
    await probot.receive(webhook);
  });

  test("waits for mergeability when it's unknown", async () => {
    nock("https://api.github.com")
      .get(
        "/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/check-runs"
      )
      .reply(200, checks);
    const unknownMergeabilityPr: typeof pullRequest = await loadFixture(
      "responses/pull_request.json"
    );
    unknownMergeabilityPr.mergeable = null;
    pullRequest.mergeable = true;
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, unknownMergeabilityPr)
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, unknownMergeabilityPr)
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, pullRequest);
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2/commits")
      .reply(200, prCommits);
    nock("https://api.github.com").put("/repos/Codertocat/Hello-World/pulls/2/merge").reply(200);

    await probot.receive(webhook);
  });

  test("does nothing when delayed mergeability is false", async () => {
    nock("https://api.github.com")
      .get(
        "/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/check-runs"
      )
      .reply(200, checks);
    const unknownMergeabilityPr: typeof pullRequest = await loadFixture(
      "responses/pull_request.json"
    );
    unknownMergeabilityPr.mergeable = null;
    pullRequest.mergeable = false;
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, unknownMergeabilityPr)
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, unknownMergeabilityPr)
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, pullRequest);

    await probot.receive(webhook);
  });

  test("does nothing when delayed mergeability never resolves", async () => {
    nock("https://api.github.com")
      .get(
        "/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/check-runs"
      )
      .reply(200, checks);
    pullRequest.mergeable = null;
    nock("https://api.github.com")
      .persist()
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, pullRequest);

    await probot.receive(webhook);
  });

  test("does nothing when any commits not committed by dependabot", async () => {
    nock("https://api.github.com")
      .get(
        "/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/check-runs"
      )
      .reply(200, checks);
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, pullRequest);
    prCommits[1].author!.login = "not-dependabot";
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2/commits")
      .reply(200, prCommits);

    await probot.receive(webhook);
  });

  test("merges PR when all constraints satisfied", async () => {
    nock("https://api.github.com")
      .get(
        "/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/check-runs"
      )
      .reply(200, checks);
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, pullRequest);
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2/commits")
      .reply(200, prCommits);
    nock("https://api.github.com").put("/repos/Codertocat/Hello-World/pulls/2/merge").reply(200);

    await probot.receive(webhook);
  });

  async function loadFixture<T>(fixture: string): Promise<T> {
    return JSON.parse(
      await fs.readFile(path.join(__dirname, "fixtures", fixture), {
        encoding: "utf-8",
      })
    );
  }

  function advanceTimersInBackground(): () => void {
    let cancelled = false;

    async function task() {
      while (!cancelled) {
        jest.runAllTimers();
        await new Promise((resolve) => builtinSetImmediate(resolve));
      }
    }

    task();
    return () => (cancelled = true);
  }
});
