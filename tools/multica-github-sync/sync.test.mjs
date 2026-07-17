import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMarker,
  desiredGithubIssue,
  findIssueByMarker,
  githubStateFor,
  githubStateReasonFor,
} from "./sync.mjs";

const config = {
  workspaceId: "workspace-1",
  workspaceSlug: "linkcv",
};

test("terminal Multica states close GitHub issues", () => {
  assert.equal(githubStateFor("done"), "closed");
  assert.equal(githubStateFor("cancelled"), "closed");
  assert.equal(githubStateFor("in_review"), "open");
  assert.equal(githubStateReasonFor("done"), "completed");
  assert.equal(githubStateReasonFor("cancelled"), "not_planned");
});

test("desired issue contains a stable identity marker", () => {
  const desired = desiredGithubIssue(
    {
      id: "issue-1",
      identifier: "LCV-1",
      title: "同步 Issue",
      description: "验收标准",
      status: "in_progress",
      priority: "high",
    },
    config,
  );

  assert.equal(desired.title, "[LCV-1] 同步 Issue");
  assert.equal(desired.state, "open");
  assert.match(desired.body, /Multica 是主数据源/);
  assert.ok(desired.body.includes(buildMarker("workspace-1", "issue-1")));
});

test("marker lookup ignores pull requests and finds the mirrored issue", () => {
  const marker = buildMarker("workspace-1", "issue-1");
  const result = findIssueByMarker(
    [
      { number: 1, body: marker, pull_request: { url: "example" } },
      { number: 2, body: `prefix\n${marker}` },
    ],
    marker,
  );
  assert.equal(result.number, 2);
});
