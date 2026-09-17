import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordMediaRequestDetail } from "../../src/sse/utils/mediaRequestDetail.js";

const originalDataDir = process.env.DATA_DIR;

describe("recordMediaRequestDetail integration", () => {
  let tempDir;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-media-detail-"));
    process.env.DATA_DIR = tempDir;
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });
  });

  afterAll(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("stores embedding detail with endpoint visible in list rows", async () => {
    recordMediaRequestDetail({
      endpoint: "/v1/embeddings",
      provider: "openai",
      model: "text-embedding-3-small",
      connectionId: "conn-1",
      status: "success",
      latencyMs: 55,
      clientBody: { model: "openai/text-embedding-3-small", input: "hi" },
      audit: {
        providerUrl: "https://api.openai.com/v1/embeddings",
        providerRequest: { model: "text-embedding-3-small", input: "hi" },
        providerResponse: { data: [{ embedding: [0.1, 0.2, 0.3, 0.4, 0.5] }] },
        clientResponse: { data: [{ embedding: [0.1, 0.2, 0.3, 0.4, 0.5] }] },
      },
      tokens: { prompt_tokens: 3, completion_tokens: 0 },
    });
    await new Promise((r) => setTimeout(r, 150));
    const db = await import("@/lib/db/index.js");
    const { details } = await db.getRequestDetails({ provider: "openai" });
    const row = details.find((d) => d.model === "text-embedding-3-small");
    expect(row).toBeDefined();
    expect(row.endpoint).toBe("/v1/embeddings");
    expect(row.status).toBe("success");
  });

  it("does not persist provider authorization headers in providerRequest", async () => {
    recordMediaRequestDetail({
      endpoint: "/v1/embeddings",
      provider: "openai",
      model: "text-embedding-3-small",
      connectionId: "conn-2",
      status: "success",
      latencyMs: 10,
      clientBody: { input: "x" },
      audit: {
        providerUrl: "https://api.openai.com/v1/embeddings",
        providerRequest: { model: "m", input: "x" },
      },
      tokens: { prompt_tokens: 1, completion_tokens: 0 },
    });
    await new Promise((r) => setTimeout(r, 150));
    const db = await import("@/lib/db/index.js");
    const full = await db.getRequestDetailById(
      (await db.getRequestDetails({ provider: "openai" })).details
        .find((d) => d.connectionId === "conn-2")?.id
    );
    expect(full?.providerRequest?.headers).toBeUndefined();
    expect(JSON.stringify(full || {})).not.toMatch(/Bearer sk-secret/i);
  });
});
