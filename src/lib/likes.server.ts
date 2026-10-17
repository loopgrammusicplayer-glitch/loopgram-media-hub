import { AwsClient } from "aws4fetch";
import { verifyUser } from "./backend.server";
import { createAdmission, type LikeResult } from "./likes.core";

const admission = createAdmission(8);
type Schema = { hash: string; range: string | undefined; expires: number };
let schema: Schema | undefined;
let schemaFlight: Promise<Schema> | undefined;
const setting = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Like service unavailable");
  return value;
};
type DdbResult = { exists: boolean; counterFloor?: boolean; Item?: Record<string, unknown>; Table?: { KeySchema: { AttributeName: string; KeyType: string }[] } };
async function request(op: string, body: Record<string, unknown>): Promise<DdbResult> {
  const client = new AwsClient({ accessKeyId: setting("AWS_ACCESS_KEY_ID"), secretAccessKey: setting("AWS_SECRET_ACCESS_KEY"), region: setting("AWS_REGION"), service: "dynamodb", retries: 0 });
  const response = await client.fetch(`https://dynamodb.${setting("AWS_REGION")}.amazonaws.com/`, {
    method: "POST", signal: AbortSignal.timeout(4000),
    headers: { "Content-Type": "application/x-amz-json-1.0", "X-Amz-Target": `DynamoDB_20120810.${op}` },
    body: JSON.stringify(op === "TransactWriteItems" ? body : { TableName: setting("DYNAMODB_TABLE_NAME"), ...body }),
  });
  const data = await response.json() as { __type?: string; Item?: Record<string, unknown>; CancellationReasons?: { Code?: string }[]; Table?: { KeySchema: { AttributeName: string; KeyType: string }[] } };
  if (!response.ok) {
    if (data.__type?.endsWith("ConditionalCheckFailedException")) return { exists: true };
    // Transaction cancelled only because the like row is already in the requested state: idempotent no-op.
    if (data.__type?.endsWith("TransactionCanceledException") && data.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed" && data.CancellationReasons.slice(1).every(r => !r.Code || r.Code === "None")) return { exists: true };
    if (data.__type?.endsWith("TransactionCanceledException") && data.CancellationReasons?.[1]?.Code === "ConditionalCheckFailed") return { exists: false, counterFloor: true };
    throw new Error("Like persistence unavailable");
  }
  return { ...data, exists: false };
}
async function keys() {
  if (schema && schema.expires > Date.now()) return schema;
  if (!schemaFlight) schemaFlight = (async () => {
    const data = await request("DescribeTable", {});
    const hash = data.Table?.KeySchema.find(k => k.KeyType === "HASH")?.AttributeName;
    if (!hash) throw new Error("Like service unavailable");
    const resolved = { hash, range: data.Table?.KeySchema.find(k => k.KeyType === "RANGE")?.AttributeName, expires: Date.now() + 3600_000 };
    schema = resolved;
    return resolved;
  })().finally(() => { schemaFlight = undefined; });
  return schemaFlight;
}
async function identity(videoId: string, uid: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([videoId, uid])));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
}
async function allow(uid: string) {
  // Atomic, bounded per-account window. Redis failure fails likes closed, not playback.
  const digest = await identity("admission", uid);
  const response = await fetch(setting("UPSTASH_REDIS_REST_URL"), {
    method: "POST", signal: AbortSignal.timeout(1000),
    headers: { Authorization: `Bearer ${setting("UPSTASH_REDIS_REST_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify(["EVAL", "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n", 1, `like-limit:${digest}`]),
  });
  if (!response.ok) throw new Error("Admission unavailable");
  const value = await response.json() as { result?: number; error?: string };
  return !value.error && typeof value.result === "number" && value.result <= 10;
}
export type LikeMode = "write" | "read" | "unlike" | "dislike" | "undislike";
const countOf = (item: Record<string, unknown> | undefined, attr: string) => Math.max(0, Number((item?.[attr] as { N?: string } | undefined)?.N ?? 0) || 0);
export async function likeAction(input: { id: string; sk: string; token: string; mode: LikeMode }): Promise<LikeResult> {
  const release = admission.enter();
  if (!release) return { status: "retry", retryAfterSeconds: 10 };
  try {
    let user;
    try { user = await verifyUser(input.token); } catch { return { status: "sign_in" }; }
    if (!user.uid) return { status: "sign_in" };
    if (input.mode !== "read" && !await allow(user.uid)) return { status: "retry", retryAfterSeconds: 60 };
    const k = await keys();
    const receipt = await identity(input.id, user.uid);
    const likeKey: Record<string, { S: string }> = { [k.hash]: { S: `LIKE#${receipt}` } };
    const dislikeKey: Record<string, { S: string }> = { [k.hash]: { S: `DISLIKE#${receipt}` } };
    if (k.range) { likeKey[k.range] = { S: "record" }; dislikeKey[k.range] = { S: "record" }; }
    const videoKey = k.range ? { [k.hash]: { S: "VIDEO" }, [k.range]: { S: input.sk } } : { [k.hash]: { S: `VIDEO#${input.id}` } };
    const readBack = async () => {
      const [mine, mineD, video] = await Promise.all([
        request("GetItem", { Key: likeKey, ConsistentRead: true }),
        request("GetItem", { Key: dislikeKey, ConsistentRead: true }),
        request("GetItem", { Key: videoKey, ConsistentRead: true }),
      ]);
      return { liked: !!mine.Item, disliked: !!mineD.Item, count: countOf(video.Item, "likes"), dislikes: countOf(video.Item, "dislikes") };
    };
    if (input.mode === "read") {
      const r = await readBack();
      return { status: r.liked || r.disliked ? "confirmed" : "unavailable", ...r };
    }
    const video = await request("GetItem", { Key: videoKey, ConsistentRead: true });
    const attributes = video.Item as Record<string, { S?: string }> | undefined;
    if (attributes?.["vid"]?.S !== input.id || attributes?.["status"]?.S === "draft" || !attributes?.["videoUrl"]?.S) return { status: "unavailable" };
    const table = setting("DYNAMODB_TABLE_NAME");
    const names = { "#pk": k.hash };
    const positive = input.mode === "write" || input.mode === "unlike";
    const Key = positive ? likeKey : dislikeKey;
    const otherKey = positive ? dislikeKey : likeKey;
    const attr = positive ? "likes" : "dislikes";
    const otherAttr = positive ? "dislikes" : "likes";
    const rowType = positive ? "like" : "dislike";
    // Reaction row + counter change commit atomically; the row condition makes retries and double taps no-ops.
    const items = input.mode === "write" || input.mode === "dislike" ? [
      { Put: { TableName: table, Item: { ...Key, type: { S: rowType }, videoId: { S: input.id }, userId: { S: user.uid }, createdAt: { S: new Date().toISOString() }, version: { N: "1" } }, ConditionExpression: "attribute_not_exists(#pk)", ExpressionAttributeNames: names } },
      { Update: { TableName: table, Key: videoKey, UpdateExpression: `ADD ${attr} :one`, ExpressionAttributeValues: { ":one": { N: "1" } } } },
    ] : [
      { Delete: { TableName: table, Key, ConditionExpression: "attribute_exists(#pk)", ExpressionAttributeNames: names } },
      { Update: { TableName: table, Key: videoKey, UpdateExpression: `ADD ${attr} :neg`, ConditionExpression: `${attr} > :zero`, ExpressionAttributeValues: { ":neg": { N: "-1" }, ":zero": { N: "0" } } } },
    ];
    const tx = await request("TransactWriteItems", { TransactItems: items }) as { counterFloor?: boolean };
    // Legacy row saved before counters existed: remove it without pushing the count below zero.
    if (tx.counterFloor && (input.mode === "unlike" || input.mode === "undislike")) await request("DeleteItem", { Key });
    // Like and dislike are mutually exclusive: setting one removes the other (best-effort, conditional so counts stay exact).
    if (input.mode === "write" || input.mode === "dislike") {
      try {
        await request("TransactWriteItems", { TransactItems: [
          { Delete: { TableName: table, Key: otherKey, ConditionExpression: "attribute_exists(#pk)", ExpressionAttributeNames: names } },
          { Update: { TableName: table, Key: videoKey, UpdateExpression: `ADD ${otherAttr} :neg`, ConditionExpression: `${otherAttr} > :zero`, ExpressionAttributeValues: { ":neg": { N: "-1" }, ":zero": { N: "0" } } } },
        ] });
      } catch { /* no opposite reaction existed — nothing to remove */ }
    }
    const r = await readBack();
    return { status: r.liked || r.disliked ? "confirmed" : "unavailable", ...r };
  } catch {
    return { status: "retry", retryAfterSeconds: 10 };
  } finally { release(); }
}
