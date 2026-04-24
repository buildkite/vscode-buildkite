import * as assert from "assert";
import { CacheProvider } from "../cache/cacheProvider";

suite("CacheProvider", () => {
  let cache: CacheProvider;

  setup(() => {
    cache = new CacheProvider(1000);
  });

  teardown(() => {
    cache.dispose();
  });

  test("should store and retrieve values", () => {
    cache.set("key1", { hello: "world" });
    const result = cache.get<{ hello: string }>("key1");
    assert.deepStrictEqual(result, { hello: "world" });
  });

  test("should return null for missing keys", () => {
    assert.strictEqual(cache.get("missing"), null);
  });

  test("should return null for expired entries", async () => {
    cache.set("key1", "value", 1); // 1ms TTL
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.strictEqual(cache.get("key1"), null);
  });

  test("should clear all entries", () => {
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    assert.strictEqual(cache.get("a"), null);
    assert.strictEqual(cache.get("b"), null);
  });

  test("should clear entries matching a pattern", () => {
    cache.set("orgs/foo/pipelines/bar", "data1");
    cache.set("orgs/foo/pipelines/baz", "data2");
    cache.set("orgs/foo/agents", "data3");
    cache.clearPattern("pipelines");
    assert.strictEqual(cache.get("orgs/foo/pipelines/bar"), null);
    assert.strictEqual(cache.get("orgs/foo/pipelines/baz"), null);
    assert.strictEqual(cache.get<string>("orgs/foo/agents"), "data3");
  });
});
