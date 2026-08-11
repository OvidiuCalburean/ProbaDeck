import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { routingFunctionCode } from "../dist/routing-function.js";

function route(host, uri) {
  return vm.runInNewContext(`${routingFunctionCode}\nhandler(event)`, {
    event: { request: { headers: { host: { value: host } }, uri } },
  });
}

await test("maps extensionless static routes to directory index files", () => {
  assert.equal(route("probadeck.com", "/").uri, "/index.html");
  assert.equal(route("probadeck.com", "/docs").uri, "/docs/index.html");
  assert.equal(route("probadeck.com", "/examples/").uri, "/examples/index.html");
  assert.equal(route("probadeck.com", "/favicon.svg").uri, "/favicon.svg");
});

await test("redirects www without exposing the S3 origin", () => {
  const response = route("www.probadeck.com", "/docs");
  assert.equal(response.statusCode, 301);
  assert.equal(response.headers.location.value, "https://probadeck.com/docs");
});
