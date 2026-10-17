import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./backend.server", () => ({ verifyUser: vi.fn(async () => ({ uid: "test-user" })) }));
const awsFetch = vi.hoisted(() => vi.fn());
vi.mock("aws4fetch", () => ({ AwsClient: class { fetch = awsFetch; } }));
import { likeAction } from "./likes.server";
import { performance } from "node:perf_hooks";
const input = { id: "00000000-0000-4000-8000-000000000001", sk: "date#video", token: "test-only-token", mode: "write" as const };
const receipts = new Map<string, unknown>();
const counter = { n: 0 };
beforeEach(() => {
  for (const key of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "DYNAMODB_TABLE_NAME", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) vi.stubEnv(key, "test-only");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: 1 })));
  receipts.clear(); counter.n = 0;
  awsFetch.mockImplementation(async (_url: string, init: RequestInit) => {
    const op = new Headers(init.headers).get("X-Amz-Target");
    const body = JSON.parse(String(init.body));
    if (op?.endsWith("DescribeTable")) return Response.json({ Table: { KeySchema: [{ AttributeName: "PK", KeyType: "HASH" }, { AttributeName: "SK", KeyType: "RANGE" }] } });
    if (op?.endsWith("GetItem")) {
      if (body.Key.PK.S === "VIDEO") return Response.json({ Item: { vid: { S: input.id }, status: { S: "published" }, videoUrl: { S: "test-only-video" }, likes: { N: String(counter.n) } } });
      return Response.json({ Item: receipts.get(body.Key.PK.S) });
    }
    if (op?.endsWith("TransactWriteItems")) {
      const first = body.TransactItems[0];
      if (first.Put) {
        if (receipts.has(first.Put.Item.PK.S)) return Response.json({ __type: "com.amazonaws.dynamodb.v20120810#TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }] }, { status: 400 });
        receipts.set(first.Put.Item.PK.S, first.Put.Item); counter.n++;
      } else {
        if (!receipts.has(first.Delete.Key.PK.S)) return Response.json({ __type: "com.amazonaws.dynamodb.v20120810#TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }] }, { status: 400 });
        receipts.delete(first.Delete.Key.PK.S); counter.n--;
      }
      return Response.json({});
    }
    expect(body.ConditionExpression).toBe("attribute_not_exists(#pk)");
    if (receipts.has(body.Item.PK.S)) return Response.json({ __type: "com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException" }, { status: 400 });
    receipts.set(body.Item.PK.S, body.Item);
    return Response.json({});
  });
});
describe("DynamoDB like wiring (isolated providers)", () => {
  it("confirms and reads back one receipt despite repeated attempts", async () => {
    expect((await likeAction(input)).status).toBe("confirmed");
    expect((await likeAction(input)).status).toBe("confirmed");
    expect(receipts.size).toBe(1);
    expect((await likeAction({ ...input, mode: "read" })).status).toBe("confirmed");
    expect([...receipts.keys()][0]).toMatch(/^LIKE#[0-9a-f]{64}$/);
  });
  it("unlike and re-like keep an exact count", async () => {
    expect(await likeAction(input)).toMatchObject({ liked: true, count: 1 });
    expect(await likeAction({ ...input, mode: "unlike" })).toMatchObject({ liked: false, count: 0 });
    expect(await likeAction({ ...input, mode: "unlike" })).toMatchObject({ liked: false, count: 0 });
    expect(await likeAction(input)).toMatchObject({ liked: true, count: 1 });
  });
  it("fails closed when Redis admission fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("redis unavailable"); }));
    expect((await likeAction(input)).status).toBe("retry");
    expect(receipts.size).toBe(0);
  });
  it("rejects the eleventh request in the account window", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: 11 })));
    expect((await likeAction(input)).status).toBe("retry");
    expect(receipts.size).toBe(0);
  });
  it("bounds progressively larger simultaneous synthetic bursts", async () => {
    for (const attempts of [100, 1000, 10000]) {
      receipts.clear();
      const start = performance.now();
      const results = await Promise.all(Array.from({ length: attempts }, () => likeAction(input)));
      const confirmed = results.filter(r => r.status === "confirmed").length;
      const retry = results.filter(r => r.status === "retry").length;
      expect(confirmed).toBe(8);
      expect(retry).toBe(attempts - 8);
      expect(receipts.size).toBe(1);
      console.info(JSON.stringify({ isolatedProviders: true, attempts, confirmed, retry, durationMs: Math.round((performance.now() - start) * 100) / 100 }));
    }
  });
});