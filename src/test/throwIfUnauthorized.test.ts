import * as assert from "node:assert/strict";
import { AuthSession, throwIfUnauthorized } from "../api/auth";

function fakeSession(): AuthSession & { invalidateCalls: number } {
  let calls = 0;
  return {
    token: "tok",
    invalidate: async () => {
      calls += 1;
    },
    get invalidateCalls() {
      return calls;
    },
  };
}

describe("throwIfUnauthorized", () => {
  it("does nothing when the response is not 401", async () => {
    const session = fakeSession();
    const response = new Response("ok", { status: 200 });
    await throwIfUnauthorized(response, session);
    assert.equal(session.invalidateCalls, 0);
  });

  it("kicks invalidate and throws on 401", async () => {
    const session = fakeSession();
    const response = new Response("nope", { status: 401 });

    await assert.rejects(
      () => throwIfUnauthorized(response, session),
      /Authentication required/,
    );
    assert.equal(session.invalidateCalls, 1);
  });

  it("does not block on the body read", async () => {
    const session = fakeSession();
    const response = new Response("won't be read", { status: 401 });
    Object.defineProperty(response, "clone", {
      value: () => ({
        text: async () => {
          throw new Error("body read failed");
        },
      }),
    });

    await assert.rejects(
      () => throwIfUnauthorized(response, session),
      /Authentication required/,
    );
    assert.equal(session.invalidateCalls, 1);
  });
});
