import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";

import { AdminApiError, AdminClient } from "../src/admin-client";

// A server that delays its response well beyond the client timeout, so the
// client's AbortController must fire first.
const server: Server = createServer((_request, response) => {
  const timer = setTimeout(() => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: 0, data: {} }));
  }, 5_000);
  timer.unref();
});

const port = await new Promise<number>((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve(typeof address === "object" && address ? address.port : 0);
  });
});

const client = new AdminClient(`http://127.0.0.1:${port}/`, undefined, {
  timeoutMs: 100,
});

let caught: unknown;
const startedAt = Date.now();
try {
  await client.post("api/test", { ping: 1 }, {});
} catch (error) {
  caught = error;
}
const elapsed = Date.now() - startedAt;

server.closeAllConnections?.();
server.close();

assert.ok(caught instanceof AdminApiError, "should throw AdminApiError");
assert.equal((caught as AdminApiError).status, 504, "should be 504 timeout");
assert.match(
  (caught as AdminApiError).message,
  /タイムアウト/,
  "message mentions timeout",
);
assert.ok(
  elapsed < 2_000,
  `should abort quickly (took ${elapsed}ms), not wait for the slow server`,
);

console.log("ok - admin client request timeout");
