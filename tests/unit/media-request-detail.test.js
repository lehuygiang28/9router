import { beforeEach, describe, expect, it, vi } from "vitest";
import { shrinkMediaPayload } from "../../src/sse/utils/mediaRequestDetail.js";

describe("shrinkMediaPayload", () => {
  it("truncates embedding vectors in response data", () => {
    const shrunk = shrinkMediaPayload({
      data: [{ embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] }],
    });
    expect(shrunk.data[0].embedding).toHaveLength(5);
    expect(String(shrunk.data[0].embedding[4])).toMatch(/6 dims/);
  });
});

const embedMocks = vi.hoisted(() => ({
  handleEmbeddingsCore: vi.fn(),
  saveRequestUsage: vi.fn(),
  saveRequestDetail: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: async () => ({
    apiKey: "provider-secret",
    connectionId: "connection-a",
    connectionName: "Provider A",
  }),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
  extractApiKey: () => "client-key",
  isValidApiKey: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ requireApiKey: false }) }));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: "openai", model: "text-embedding-3-small" }),
}));
vi.mock("../../open-sse/handlers/embeddingsCore.js", () => ({
  handleEmbeddingsCore: embedMocks.handleEmbeddingsCore,
}));
vi.mock("../../open-sse/utils/error.js", () => ({
  errorResponse: (status, message) => Response.json({ error: message }, { status }),
  unavailableResponse: (status, message) => Response.json({ error: message }, { status }),
}));
vi.mock("../../src/sse/utils/logger.js", () => ({
  request: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), maskKey: vi.fn(),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: async (_provider, credentials) => credentials,
}));
vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: (...args) => embedMocks.saveRequestUsage(...args),
  saveRequestDetail: (...args) => embedMocks.saveRequestDetail(...args),
}));

import { handleEmbeddings } from "../../src/sse/handlers/embeddings.js";

describe("embedding handler request details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    embedMocks.saveRequestDetail.mockResolvedValue(undefined);
    embedMocks.saveRequestUsage.mockResolvedValue(undefined);
  });

  it("calls saveRequestDetail on success and error", async () => {
    embedMocks.handleEmbeddingsCore.mockResolvedValueOnce({
      success: true,
      usage: { prompt_tokens: 12, total_tokens: 12 },
      response: Response.json({ data: [{ embedding: [0.1] }] }),
      audit: {
        providerUrl: "https://api.openai.com/v1/embeddings",
        providerRequest: { model: "text-embedding-3-small", input: "hello" },
        providerResponse: { data: [] },
        clientResponse: { data: [{ embedding: [0.1] }] },
        latencyMs: 42,
      },
    });

    await handleEmbeddings(new Request("http://localhost/v1/embeddings", {
      method: "POST",
      body: JSON.stringify({ model: "openai/text-embedding-3-small", input: "hello" }),
    }));

    expect(embedMocks.saveRequestDetail).toHaveBeenCalled();
    const successDetail = embedMocks.saveRequestDetail.mock.calls[0][0];
    expect(successDetail.status).toBe("success");
    expect(successDetail.endpoint).toBe("/v1/embeddings");

    embedMocks.handleEmbeddingsCore.mockResolvedValueOnce({
      success: false,
      status: 502,
      error: "upstream failed",
      response: Response.json({ error: "upstream failed" }, { status: 502 }),
      audit: {
        providerUrl: "https://api.openai.com/v1/embeddings",
        providerRequest: { model: "text-embedding-3-small", input: "hello" },
        providerResponse: { error: { message: "upstream failed" } },
        latencyMs: 10,
      },
    });

    await handleEmbeddings(new Request("http://localhost/v1/embeddings", {
      method: "POST",
      body: JSON.stringify({ model: "openai/text-embedding-3-small", input: "hello" }),
    }));

    expect(embedMocks.saveRequestDetail).toHaveBeenCalledTimes(2);
    expect(embedMocks.saveRequestDetail.mock.calls[1][0].status).toBe("error");
  });
});
