import { access, mkdir, open, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import https from "node:https";
import path from "node:path";
import { tmpdir } from "node:os";

import type { ApiRuntimeConfig } from "../env.ts";
import { safeEqualText, signValue } from "../utils.ts";

const LOCAL_PROOF_UPLOAD_ROOT = path.join(tmpdir(), "buto-proof-uploads");

const MIME_EXTENSIONS = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/heic", "heic"],
  ["image/heif", "heif"]
]);

export type ProofUploadMode = "SIGNED_UPLOAD_POST" | "S3_PRESIGNED_PUT";

export interface SignedProofUploadDescriptor {
  uploadMode: ProofUploadMode;
  uploadMethod: "POST" | "PUT";
  uploadUrl: string;
  publicAssetBaseUrl: string;
  uploadHeaders?: Record<string, string>;
}

export interface StoredProofAsset {
  objectKey: string;
  localAssetPath?: string;
}

export interface ProofAssetVerificationInput {
  objectKey: string;
  maxBytes: number;
  acceptedMimeTypes: string[];
}

export interface ProofAssetStorageProvider {
  readonly providerType: "local" | "s3";
  readonly supportsServerUploadRoute: boolean;
  createObjectKey(input: { jobId: string; proofType: "pickup" | "delivery"; uploadSessionId: string; mimeType: string }): string | null;
  createSignedUploadDescriptor(input: { uploadSessionId: string; expiresAt: string; objectKey: string; mimeType: string }): SignedProofUploadDescriptor;
  verifySignedUpload(uploadSessionId: string, expiresAt: string, signature: string): boolean;
  saveUploadedAsset(input: { objectKey: string; buffer: Buffer }): Promise<StoredProofAsset>;
  verifyUploadedAsset(input: ProofAssetVerificationInput): Promise<StoredProofAsset | null>;
  buildPublicProofUrl(objectKey: string): string;
}

interface ProofDescriptorInput {
  uploadSessionId: string;
  expiresAt: string;
  objectKey: string;
  mimeType: string;
}

export interface S3ProbeTransport {
  head(input: { url: string; headers: Record<string, string> }): Promise<{ status: number; headers: Record<string, string> }>;
  getRange(input: { url: string; headers: Record<string, string>; rangeHeader: string }): Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;
}

function detectImageMime(buffer: Buffer): string | null {
  if (buffer.byteLength >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }

  if (buffer.byteLength >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (buffer.byteLength >= 12) {
    const boxType = buffer.subarray(4, 12).toString("ascii");
    if (boxType === "ftypheic" || boxType === "ftypheix" || boxType === "ftyphevc" || boxType === "ftyphevx") {
      return "image/heic";
    }
    if (boxType === "ftypmif1" || boxType === "ftypmsf1") {
      return "image/heif";
    }
  }

  return null;
}

function hashHex(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function toDateStamp(date: Date) {
  return toAmzDate(date).slice(0, 8);
}

function normalizeHeaders(headers: Record<string, string>) {
  return Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase().trim(), value.trim().replace(/\s+/g, " ")] as const)
    .sort(([left], [right]) => left.localeCompare(right));
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQueryString(query: Array<[string, string]>) {
  return [...query]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyCompare = leftKey.localeCompare(rightKey);
      return keyCompare !== 0 ? keyCompare : leftValue.localeCompare(rightValue);
    })
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string) {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

function buildS3Path(bucket: string, objectKey: string) {
  return `/${bucket}/${objectKey.split("/").map((part) => encodeRfc3986(part)).join("/")}`;
}

async function readLocalMagicBytes(filePath: string) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(32);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function defaultS3ProbeTransport(): S3ProbeTransport {
  return {
    async head(input) {
      return performHttpsBufferRequest(input.url, "HEAD", input.headers).then((result) => ({
        status: result.status,
        headers: result.headers
      }));
    },
    async getRange(input) {
      return performHttpsBufferRequest(input.url, "GET", {
        ...input.headers,
        range: input.rangeHeader
      });
    }
  };
}

async function performHttpsBufferRequest(url: string, method: "GET" | "HEAD", headers: Record<string, string>) {
  return new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
    const request = https.request(url, { method, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: Object.fromEntries(Object.entries(response.headers).flatMap(([key, value]) => (typeof value === "string" ? [[key.toLowerCase(), value]] : []))),
          body: Buffer.concat(chunks)
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

export class LocalSignedProofAssetStorageProvider implements ProofAssetStorageProvider {
  readonly providerType = "local" as const;
  readonly supportsServerUploadRoute = true;

  constructor(private readonly runtimeConfig: ApiRuntimeConfig) {}

  createObjectKey(input: { jobId: string; proofType: "pickup" | "delivery"; uploadSessionId: string; mimeType: string }) {
    const extension = MIME_EXTENSIONS.get(input.mimeType);
    if (!extension) {
      return null;
    }

    return `${input.jobId}/${input.proofType}/${input.uploadSessionId}.${extension}`;
  }

  createSignedUploadDescriptor(input: ProofDescriptorInput) {
    const signature = this.buildUploadSignature(input.uploadSessionId, input.expiresAt);
    return {
      uploadMode: "SIGNED_UPLOAD_POST",
      uploadMethod: "POST",
      uploadUrl: `${this.runtimeConfig.uploadPublicBaseUrl}/uploads/proof/${input.uploadSessionId}?expiresAt=${encodeURIComponent(input.expiresAt)}&signature=${encodeURIComponent(signature)}`,
      publicAssetBaseUrl: this.runtimeConfig.proofPublicBaseUrl
    };
  }

  verifySignedUpload(uploadSessionId: string, expiresAt: string, signature: string) {
    return safeEqualText(signature, this.buildUploadSignature(uploadSessionId, expiresAt));
  }

  async saveUploadedAsset(input: { objectKey: string; buffer: Buffer }) {
    const localAssetPath = path.join(LOCAL_PROOF_UPLOAD_ROOT, input.objectKey);
    await mkdir(path.dirname(localAssetPath), { recursive: true });
    await writeFile(localAssetPath, input.buffer);
    return {
      objectKey: input.objectKey,
      localAssetPath
    };
  }

  async verifyUploadedAsset(input: ProofAssetVerificationInput) {
    const localAssetPath = path.join(LOCAL_PROOF_UPLOAD_ROOT, input.objectKey);
    try {
      await access(localAssetPath, fsConstants.R_OK);
      const fileStats = await stat(localAssetPath);
      if (!fileStats.isFile() || fileStats.size <= 0 || fileStats.size > input.maxBytes) {
        return null;
      }
      const magic = await readLocalMagicBytes(localAssetPath);
      const detectedMime = detectImageMime(magic);
      if (!detectedMime || !input.acceptedMimeTypes.includes(detectedMime)) {
        return null;
      }
      return {
        objectKey: input.objectKey,
        localAssetPath
      };
    } catch {
      return null;
    }
  }

  buildPublicProofUrl(objectKey: string) {
    return `${this.runtimeConfig.proofPublicBaseUrl}/${objectKey}?wm=1`;
  }

  private buildUploadSignature(uploadSessionId: string, expiresAt: string) {
    return signValue(`${uploadSessionId}:${expiresAt}`, this.runtimeConfig.authTokenSecret);
  }
}

export class S3PresignedPutProofAssetStorageProvider implements ProofAssetStorageProvider {
  readonly providerType = "s3" as const;
  readonly supportsServerUploadRoute = false;

  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly signedUrlTtlSeconds: number;
  private readonly probeTransport: S3ProbeTransport;

  constructor(
    private readonly runtimeConfig: ApiRuntimeConfig,
    probeTransport: S3ProbeTransport = defaultS3ProbeTransport()
  ) {
    if (!runtimeConfig.proofS3Bucket || !runtimeConfig.proofS3Region || !runtimeConfig.proofS3Endpoint || !runtimeConfig.proofS3AccessKeyId || !runtimeConfig.proofS3SecretAccessKey) {
      throw new Error("Missing S3 proof storage configuration");
    }

    this.bucket = runtimeConfig.proofS3Bucket;
    this.region = runtimeConfig.proofS3Region;
    this.endpoint = runtimeConfig.proofS3Endpoint.replace(/\/$/, "");
    this.accessKeyId = runtimeConfig.proofS3AccessKeyId;
    this.secretAccessKey = runtimeConfig.proofS3SecretAccessKey;
    this.signedUrlTtlSeconds = runtimeConfig.proofS3SignedUrlTtlSeconds;
    this.probeTransport = probeTransport;
  }

  createObjectKey(input: { jobId: string; proofType: "pickup" | "delivery"; uploadSessionId: string; mimeType: string }) {
    const extension = MIME_EXTENSIONS.get(input.mimeType);
    if (!extension) {
      return null;
    }

    return `${input.jobId}/${input.proofType}/${input.uploadSessionId}.${extension}`;
  }

  createSignedUploadDescriptor(input: ProofDescriptorInput) {
    const requestDate = new Date();
    const amzDate = toAmzDate(requestDate);
    const dateStamp = toDateStamp(requestDate);
    const endpointUrl = new URL(this.endpoint);
    const canonicalUri = buildS3Path(this.bucket, input.objectKey);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const query: Array<[string, string]> = [
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", `${this.accessKeyId}/${credentialScope}`],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(this.signedUrlTtlSeconds)],
      ["X-Amz-SignedHeaders", "host"]
    ];
    const canonicalRequest = [
      "PUT",
      canonicalUri,
      canonicalQueryString(query),
      `host:${endpointUrl.host}\n`,
      "host",
      "UNSIGNED-PAYLOAD"
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      hashHex(canonicalRequest)
    ].join("\n");
    const signature = createHmac("sha256", signingKey(this.secretAccessKey, dateStamp, this.region, "s3"))
      .update(stringToSign)
      .digest("hex");
    const signedQuery = canonicalQueryString([...query, ["X-Amz-Signature", signature]]);

    return {
      uploadMode: "S3_PRESIGNED_PUT",
      uploadMethod: "PUT",
      uploadUrl: `${this.endpoint}${canonicalUri}?${signedQuery}`,
      publicAssetBaseUrl: this.runtimeConfig.proofPublicBaseUrl,
      uploadHeaders: {
        "content-type": input.mimeType
      }
    };
  }

  verifySignedUpload() {
    return false;
  }

  async saveUploadedAsset() {
    throw new Error("S3 provider does not support server-mediated proof upload");
  }

  async verifyUploadedAsset(input: ProofAssetVerificationInput) {
    const objectUrl = `${this.endpoint}${buildS3Path(this.bucket, input.objectKey)}`;
    const headHeaders = this.buildSignedHeaders("HEAD", objectUrl);
    const headResponse = await this.probeTransport.head({
      url: objectUrl,
      headers: headHeaders
    });
    if (headResponse.status < 200 || headResponse.status >= 300) {
      return null;
    }

    const contentLength = Number(headResponse.headers["content-length"] ?? "0");
    if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > input.maxBytes) {
      return null;
    }

    const rangeHeaders = this.buildSignedHeaders("GET", objectUrl, {
      range: "bytes=0-31"
    });
    const rangeResponse = await this.probeTransport.getRange({
      url: objectUrl,
      headers: rangeHeaders,
      rangeHeader: "bytes=0-31"
    });
    if (rangeResponse.status !== 206 && rangeResponse.status !== 200) {
      return null;
    }

    const detectedMime = detectImageMime(rangeResponse.body);
    if (!detectedMime || !input.acceptedMimeTypes.includes(detectedMime)) {
      return null;
    }

    return {
      objectKey: input.objectKey
    };
  }

  buildPublicProofUrl(objectKey: string) {
    return `${this.runtimeConfig.proofPublicBaseUrl}/${objectKey}?wm=1`;
  }

  private buildSignedHeaders(method: "GET" | "HEAD", objectUrl: string, extraHeaders: Record<string, string> = {}) {
    const requestDate = new Date();
    const amzDate = toAmzDate(requestDate);
    const dateStamp = toDateStamp(requestDate);
    const url = new URL(objectUrl);
    const baseHeaders = normalizeHeaders({
      host: url.host,
      "x-amz-content-sha256": hashHex(""),
      "x-amz-date": amzDate,
      ...extraHeaders
    });
    const signedHeaders = baseHeaders.map(([key]) => key).join(";");
    const canonicalHeaders = `${baseHeaders.map(([key, value]) => `${key}:${value}\n`).join("")}`;
    const canonicalRequest = [
      method,
      url.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      hashHex("")
    ].join("\n");
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      hashHex(canonicalRequest)
    ].join("\n");
    const signature = createHmac("sha256", signingKey(this.secretAccessKey, dateStamp, this.region, "s3"))
      .update(stringToSign)
      .digest("hex");

    return {
      ...Object.fromEntries(baseHeaders),
      authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    };
  }
}

export function createProofAssetStorageProvider(runtimeConfig: ApiRuntimeConfig) {
  return runtimeConfig.proofStorageProvider === "s3"
    ? new S3PresignedPutProofAssetStorageProvider(runtimeConfig)
    : new LocalSignedProofAssetStorageProvider(runtimeConfig);
}
