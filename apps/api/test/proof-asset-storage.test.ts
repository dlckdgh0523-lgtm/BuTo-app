import test from "node:test";
import assert from "node:assert/strict";

import { loadApiRuntimeConfig } from "../src/env.ts";
import { S3PresignedPutProofAssetStorageProvider } from "../src/modules/proof-asset-storage.ts";

test("s3 proof provider creates presigned put descriptor", async () => {
  const provider = new S3PresignedPutProofAssetStorageProvider(
    loadApiRuntimeConfig({
      ...process.env,
      BUTO_PROOF_STORAGE_PROVIDER: "s3",
      BUTO_PROOF_PUBLIC_BASE_URL: "https://cdn.buto.example/proofs",
      BUTO_PROOF_S3_BUCKET: "buto-proof-bucket",
      BUTO_PROOF_S3_REGION: "ap-northeast-2",
      BUTO_PROOF_S3_ENDPOINT: "https://s3.ap-northeast-2.amazonaws.com",
      BUTO_PROOF_S3_ACCESS_KEY_ID: "proof-access-key",
      BUTO_PROOF_S3_SECRET_ACCESS_KEY: "proof-secret-key"
    }),
    {
      async head() {
        return { status: 404, headers: {} };
      },
      async getRange() {
        return { status: 404, headers: {}, body: Buffer.alloc(0) };
      }
    }
  );

  const descriptor = provider.createSignedUploadDescriptor({
    uploadSessionId: "proof-upload-1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    objectKey: "job-1/pickup/proof-upload-1.png",
    mimeType: "image/png"
  });

  assert.equal(descriptor.uploadMode, "S3_PRESIGNED_PUT");
  assert.equal(descriptor.uploadMethod, "PUT");
  assert.match(descriptor.uploadUrl, /^https:\/\/s3\.ap-northeast-2\.amazonaws\.com\/buto-proof-bucket\/job-1\/pickup\/proof-upload-1\.png\?/);
  assert.equal(descriptor.uploadHeaders?.["content-type"], "image/png");
});

test("s3 proof provider verifies uploaded image via head and range probe", async () => {
  const provider = new S3PresignedPutProofAssetStorageProvider(
    loadApiRuntimeConfig({
      ...process.env,
      BUTO_PROOF_STORAGE_PROVIDER: "s3",
      BUTO_PROOF_PUBLIC_BASE_URL: "https://cdn.buto.example/proofs",
      BUTO_PROOF_S3_BUCKET: "buto-proof-bucket",
      BUTO_PROOF_S3_REGION: "ap-northeast-2",
      BUTO_PROOF_S3_ENDPOINT: "https://s3.ap-northeast-2.amazonaws.com",
      BUTO_PROOF_S3_ACCESS_KEY_ID: "proof-access-key",
      BUTO_PROOF_S3_SECRET_ACCESS_KEY: "proof-secret-key"
    }),
    {
      async head() {
        return {
          status: 200,
          headers: {
            "content-length": "1024"
          }
        };
      },
      async getRange() {
        return {
          status: 206,
          headers: {},
          body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        };
      }
    }
  );

  const verified = await provider.verifyUploadedAsset({
    objectKey: "job-1/pickup/proof-upload-1.png",
    maxBytes: 5 * 1024 * 1024,
    acceptedMimeTypes: ["image/png", "image/jpeg"]
  });

  assert.deepEqual(verified, {
    objectKey: "job-1/pickup/proof-upload-1.png"
  });
});
