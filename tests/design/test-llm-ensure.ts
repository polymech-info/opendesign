import assert from "node:assert/strict";

import { llmPortCandidates, parseLlmUrl } from "../../src/server/llm.ts";

assert.deepEqual(parseLlmUrl("http://127.0.0.1:8090"), {
  url: "http://127.0.0.1:8090",
  host: "127.0.0.1",
  port: 8090,
});
assert.equal(parseLlmUrl("http://127.0.0.1").port, 8090);

assert.deepEqual(llmPortCandidates(8090, true), [8090]);
assert.deepEqual(llmPortCandidates(8090, false, 3), [8090, 8091, 8092]);

console.log("test-llm-ensure: ok");
