import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";

import { AdminClient } from "../src/admin-client";

// Counts how many times the JWT login endpoint is hit. With single-flight, a
// burst of concurrent requests that all need a token must only log in once.
let loginCount = 0;

const server: Server = createServer((request, response) => {
  if (request.url?.includes("getJwtToken")) {
    loginCount += 1;
    // Delay so all concurrent callers overlap on the same in-flight login.
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          code: 0,
          data: { token: { expires_in: 3600, token: "test-token" } },
        }),
      );
    }, 50);
    return;
  }

  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ code: 0, data: {} }));
});

const port = await new Promise<number>((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve(typeof address === "object" && address ? address.port : 0);
  });
});

const client = new AdminClient(`http://127.0.0.1:${port}/`, {
  password: "secret",
  username: "admin",
});

// Fire many concurrent requests; all of them need authorization at once.
await Promise.all(
  Array.from({ length: 12 }, () => client.post("api/test", { ping: 1 }, {})),
);

assert.equal(
  loginCount,
  1,
  `concurrent requests should share one login, got ${loginCount}`,
);

// A later request reuses the cached token without logging in again.
await client.post("api/test", { ping: 2 }, {});
assert.equal(loginCount, 1, `cached token should be reused, got ${loginCount}`);

server.closeAllConnections?.();
server.close();

console.log("ok - admin client login single-flight");
