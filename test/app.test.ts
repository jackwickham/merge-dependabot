import {Probot, ProbotOctokit} from "probot";
import {WebhookEvent, EventPayloads} from "@octokit/webhooks";
import {RestEndpointMethodTypes} from "@octokit/plugin-rest-endpoint-methods";
import {promises as fs} from "fs";
import path from "path";
import nock from "nock";
import mergeApp from "../src/app";

describe("app", () => {
  let probot: Probot;
  let webhook: WebhookEvent<EventPayloads.WebhookPayloadCheckSuite>;
  let commitStatus: RestEndpointMethodTypes["repos"]["getCombinedStatusForRef"]["response"]["data"];
  let pullRequest: RestEndpointMethodTypes["pulls"]["get"]["response"]["data"];

  beforeEach(async () => {
    nock.disableNetConnect();
    probot = new Probot({
      githubToken: "test",
      Octokit: ProbotOctokit.defaults({
        retry: {enabled: false},
        throttle: {enabled: false},
      }),
    });
    mergeApp(probot);

    webhook = await loadFixture("webhooks/check_suite_completed.json");
    commitStatus = await loadFixture("responses/combined_status.json");
    pullRequest = await loadFixture("responses/pull_request.json");
  });

  afterEach(() => {
    expect(nock.pendingMocks()).toEqual([]);
    expect(nock.isDone()).toBe(true);
  });

  test("does nothing when check failed", async () => {
    commitStatus.state = "failure";
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/status")
      .reply(200, commitStatus);
    await probot.receive(webhook);
  });

  test("does nothing when no checks", async () => {
    commitStatus.total_count = 0;
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/status")
      .reply(200, commitStatus);
    await probot.receive(webhook);
  });

  test("does nothing when PR not created by dependabot", async () => {
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/status")
      .reply(200, commitStatus);
    pullRequest.user!.login = "not-dependabot";
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, pullRequest);
    await probot.receive(webhook);
  });

  test("does nothing when PR head has changed", async () => {
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/status")
      .reply(200, commitStatus);
    pullRequest.head.sha = "ffff";
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, pullRequest);
    await probot.receive(webhook);
  });

  test("does nothing when PR not mergeable", async () => {
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/status")
      .reply(200, commitStatus);
    pullRequest.mergeable = false;
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, pullRequest);
    await probot.receive(webhook);
  });

  test("merges PR when all constraints satisfied", async () => {
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/commits/ec26c3e57ca3a959ca5aad62de7213c562f8c821/status")
      .reply(200, commitStatus);
    nock("https://api.github.com")
      .get("/repos/Codertocat/Hello-World/pulls/2")
      .reply(200, pullRequest);
    nock("https://api.github.com")
      .put("/repos/Codertocat/Hello-World/pulls/2/merge")
      .reply(200);

    await probot.receive(webhook);
  });

  async function loadFixture<T>(fixture: string): Promise<T> {
    return JSON.parse(
      await fs.readFile(path.join(__dirname, "fixtures", fixture), {
        encoding: "utf-8",
      })
    );
  }
});
