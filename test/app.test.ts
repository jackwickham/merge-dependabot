import { Probot, ProbotOctokit } from "probot";
import {WebhookEvent, EventPayloads} from "@octokit/webhooks"
import {promises as fs} from "fs";
import path from "path";
import nock from "nock";
import app from "../src/app";

describe("app", () => {
  let probot: Probot;
  let event: WebhookEvent<EventPayloads.WebhookPayloadPullRequest>;

  beforeEach(async () => {
    nock.disableNetConnect();
    probot = new Probot({
      githubToken: "test",
      Octokit: ProbotOctokit.defaults({
        retry: {enabled: false},
        throttle: {enabled: false},
      })
    });
    app(probot);
    event = JSON.parse(await fs.readFile(path.join(__dirname, "fixtures/webhooks/pull_request.json"), {encoding: "utf-8"}));
  });

  afterEach(() => {
    expect(nock.isDone()).toBe(true);
  });

  test("does nothing when PR not created by dependabot", async () => {
    event.payload.pull_request.user.login = "not-dependabot";
    await probot.receive(event);
  });

  test("does nothing when event not a PR created event", async () => {
    event.payload.action = "edited";
    await probot.receive(event);
  });

  test("adds comment when PR created by dependabot", async () => {
    nock("https://api.github.com")
      .post("/repos/Codertocat/Hello-World/issues/2/comments", (body) => {
        expect(body.body).toEqual("@dependabot squash and merge");
        return true;
      })
      .reply(201)

    await probot.receive(event);
  });
});
