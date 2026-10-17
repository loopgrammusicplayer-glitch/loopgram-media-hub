import { AwsClient } from "aws4fetch";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createCache } from "./cache.core";
import { fetchWithDeadline, PERFORMANCE } from "./performance";
import { firebaseWebConfig } from "./firebase-config.core";

const env = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`Missing server setting: ${k}`);
  return v;
};

// ---------- Redis (Upstash REST) ----------
export async function redis<T = unknown>(...cmd: (string | number)[]): Promise<T | null> {
  const res = await fetchWithDeadline(env("UPSTASH_REDIS_REST_URL"), {
    method: "POST",
    headers: { Authorization: `Bearer ${env("UPSTASH_REDIS_REST_TOKEN")}` },
    body: JSON.stringify(cmd),
  }, PERFORMANCE.redisTimeoutMs);
  if (!res.ok) throw new Error(`Redis ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { result: T; error?: string };
  if (j.error) throw new Error("Cache command failed");
  return j.result ?? null;
}

// Per-server memory layer (5 s) + in-flight dedupe: many simultaneous identical requests share one Redis/DB call (stampede protection).
const contentCache = createCache({
  read: (key) => redis<string>("GET", key),
  write: (key, value, ttl) => redis("SET", key, value, "EX", ttl),
});
export const cacheMetrics = () => ({ ...contentCache.metrics });
export async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  return contentCache.get(key, ttl, load);
}
// Drop memory copies too when content changes.
export function forget(...keys: string[]) { contentCache.forget(...keys); }

// ---------- DynamoDB ----------
const aws = () =>
  new AwsClient({
    accessKeyId: env("AWS_ACCESS_KEY_ID"),
    secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
    region: env("AWS_REGION"),
    service: "dynamodb",
    retries: 0,
  });

export async function ddb<T = any>(op: string, body: Record<string, unknown>): Promise<T> {
  const res = await aws().fetch(`https://dynamodb.${env("AWS_REGION")}.amazonaws.com/`, {
    method: "POST",
    signal: AbortSignal.timeout(PERFORMANCE.databaseTimeoutMs),
    headers: {
      "Content-Type": "application/x-amz-json-1.0",
      "X-Amz-Target": `DynamoDB_20120810.${op}`,
    },
    body: JSON.stringify({ TableName: env("DYNAMODB_TABLE_NAME"), ...body }),
  });
  if (!res.ok) throw new Error(`DynamoDB ${op} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

type Keys = { hash: string; range?: string | undefined };
export async function tableKeys(): Promise<Keys> {
  return cached("ddb:keys", 86400, async () => {
    const r = await ddb<{ Table: { KeySchema: { AttributeName: string; KeyType: string }[] } }>(
      "DescribeTable",
      {},
    );
    const ks = r.Table.KeySchema;
    const hash = ks.find((k) => k.KeyType === "HASH")?.AttributeName;
    if (!hash) throw new Error("Database key configuration unavailable");
    return {
      hash,
      range: ks.find((k) => k.KeyType === "RANGE")?.AttributeName,
    };
  });
}

// ---------- R2 ----------
const r2 = () =>
  new AwsClient({
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    region: "auto",
    service: "s3",
  });
const r2Base = () =>
  `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${env("R2_BUCKET_NAME")}`;

export async function presignPut(key: string, contentType: string) {
  const url = new URL(`${r2Base()}/${key}`);
  url.searchParams.set("X-Amz-Expires", "900");
  const signed = await r2().sign(new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }), {
    aws: { signQuery: true },
  });
  return signed.url;
}
export const publicUrl = (key: string) => `${env("R2_PUBLIC_URL").replace(/\/$/, "")}/${key}`;
export async function r2Ping() {
  const res = await r2().fetch(`${r2Base()}?list-type=2&max-keys=1`);
  if (!res.ok) throw new Error(`R2 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

// ---------- Firebase token verification ----------
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);
export async function verifyUser(token: string | undefined) {
  if (!token) throw new Error("Not signed in");
  const pid = process.env["FIREBASE_PROJECT_ID"]?.trim() || firebaseWebConfig().projectId;
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${pid}`,
    audience: pid,
  });
  const uid = payload.sub;
  if (!uid) throw new Error("Invalid user identity");
  const ownerUid = (process.env["OWNER_UID"] || process.env["FIREBASE_OWNER_UID"] || "").trim();
  if (!ownerUid) throw new Error("Missing server setting: OWNER_UID");
  const role: "owner" | "user" = uid === ownerUid ? "owner" : "user";
  return { uid, email: (payload["email"] as string) ?? null, name: (payload["name"] as string) ?? null, picture: (payload["picture"] as string) ?? null, role };
}

export async function r2Put(key: string, body: ArrayBuffer, contentType: string) {
  const res = await r2().fetch(`${r2Base()}/${key}`, {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" },
  });
  if (!res.ok) throw new Error(`R2 upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
export async function r2Delete(key: string) {
  const res = await r2().fetch(`${r2Base()}/${key}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`R2 delete ${res.status}`);
}
export async function r2List(prefix = "") {
  const out: { key: string; size: number; modified: string }[] = [];
  let continuation = "";
  const decode = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  do {
    const url = new URL(r2Base());
    url.searchParams.set("list-type", "2"); url.searchParams.set("max-keys", "1000"); url.searchParams.set("prefix", prefix);
    if (continuation) url.searchParams.set("continuation-token", continuation);
    const res = await r2().fetch(url.toString());
    if (!res.ok) throw new Error(`R2 list ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const xml = await res.text();
    out.push(...[...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => {
      const content = m[1] ?? "";
      return { key: decode(/<Key>(.*?)<\/Key>/.exec(content)?.[1] ?? ""), size: Number(/<Size>(.*?)<\/Size>/.exec(content)?.[1] ?? 0), modified: /<LastModified>(.*?)<\/LastModified>/.exec(content)?.[1] ?? "" };
    }));
    continuation = decode(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "");
  } while (continuation);
  return out;
}

// ---------- R2 multipart (resumable) ----------
/** Short-lived (15 min) signed URL so the browser can PUT one part straight to R2. */
export async function mpSignPart(key: string, uploadId: string, n: number) {
  const url = new URL(`${r2Base()}/${key}`);
  url.searchParams.set("partNumber", String(n));
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("X-Amz-Expires", "900");
  return (await r2().sign(new Request(url, { method: "PUT" }), { aws: { signQuery: true } })).url;
}
const tag = (xml: string, t: string) => new RegExp(`<${t}>(.*?)</${t}>`).exec(xml)?.[1] ?? "";
export async function mpCreate(key: string, contentType: string) {
  const res = await r2().fetch(`${r2Base()}/${key}?uploads`, {
    method: "POST",
    headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" },
  });
  if (!res.ok) throw new Error(`R2 multipart create ${res.status}`);
  return tag(await res.text(), "UploadId");
}
export async function mpPart(key: string, uploadId: string, n: number, body: ArrayBuffer) {
  const res = await r2().fetch(`${r2Base()}/${key}?partNumber=${n}&uploadId=${encodeURIComponent(uploadId)}`, { method: "PUT", body });
  if (!res.ok) throw new Error(`R2 part ${n} ${res.status}: ${(await res.text()).slice(0, 150)}`);
  return res.headers.get("etag") ?? "";
}
export async function mpList(key: string, uploadId: string) {
  const res = await r2().fetch(`${r2Base()}/${key}?uploadId=${encodeURIComponent(uploadId)}&max-parts=10000`);
  if (!res.ok) throw new Error(`R2 list parts ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map((m) => ({
    n: Number(tag(m[1]!, "PartNumber")),
    etag: tag(m[1]!, "ETag").replace(/&quot;/g, '"'),
  }));
}
export async function mpComplete(key: string, uploadId: string, parts: { n: number; etag: string }[]) {
  const xml = `<CompleteMultipartUpload>${parts
    .sort((a, b) => a.n - b.n)
    .map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag}</ETag></Part>`)
    .join("")}</CompleteMultipartUpload>`;
  const res = await r2().fetch(`${r2Base()}/${key}?uploadId=${encodeURIComponent(uploadId)}`, { method: "POST", body: xml });
  const t = await res.text();
  if (!res.ok || t.includes("<Error>")) throw new Error(`R2 complete ${res.status}: ${t.slice(0, 200)}`);
}
export async function mpAbort(key: string, uploadId: string) {
  await r2().fetch(`${r2Base()}/${key}?uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE" });
}

/** Stream an object (optionally a byte range) from R2. */
export async function r2Get(key: string, range?: string | null) {
  return r2().fetch(`${r2Base()}/${key}`, { headers: range ? { Range: range } : {} });
}
