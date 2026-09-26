import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  getUsageForProvider: vi.fn(),
  refreshAndUpdateCredentials: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: mocks.getUsageForProvider,
}));

vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ needsRefresh: () => false })),
}));

describe("quota routing unlock", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.refreshAndUpdateCredentials.mockImplementation(async (connection) => ({ connection, refreshed: false }));
  });

  describe("unlockConnectionIfQuotaRecovered", () => {
    it("unlocks codex when usage shows session quota remaining", async () => {
      const { unlockConnectionIfQuotaRecovered } = await import("../../src/shared/services/quotaRoutingUnlock.js");
      const connection = {
        id: "conn_1",
        provider: "codex",
        testStatus: "unavailable",
        "modelLock_gpt-5": "2099-01-01T00:00:00.000Z",
      };
      const usage = {
        limitReached: false,
        quotas: { session: { used: 10, total: 100, remaining: 90, unlimited: false } },
      };
      const update = vi.fn().mockResolvedValue({});

      const result = await unlockConnectionIfQuotaRecovered(connection, usage, update);

      expect(result).toEqual({ unlocked: true });
      expect(update).toHaveBeenCalledWith("conn_1", { testStatus: "active" });
    });

    it("does not unlock when codex session quota is exhausted", async () => {
      const { unlockConnectionIfQuotaRecovered } = await import("../../src/shared/services/quotaRoutingUnlock.js");
      const connection = {
        id: "conn_1",
        provider: "codex",
        testStatus: "unavailable",
        "modelLock_gpt-5": "2099-01-01T00:00:00.000Z",
      };
      const usage = {
        limitReached: true,
        quotas: { session: { used: 100, total: 100, remaining: 0, unlimited: false } },
      };
      const update = vi.fn();

      const result = await unlockConnectionIfQuotaRecovered(connection, usage, update);

      expect(result).toEqual({ unlocked: false });
      expect(update).not.toHaveBeenCalled();
    });

    it("does nothing when connection is not locked", async () => {
      const { unlockConnectionIfQuotaRecovered } = await import("../../src/shared/services/quotaRoutingUnlock.js");
      const connection = { id: "conn_1", provider: "codex", testStatus: "active" };
      const usage = {
        limitReached: false,
        quotas: { session: { used: 0, total: 100, remaining: 100, unlimited: false } },
      };
      const update = vi.fn();

      const result = await unlockConnectionIfQuotaRecovered(connection, usage, update);

      expect(result).toEqual({ unlocked: false });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("usage GET route", () => {
    it("unlocks codex after quota refresh when upstream quota recovered", async () => {
      const lockedConnection = {
        id: "conn_codex",
        provider: "codex",
        authType: "oauth",
        accessToken: "token",
        testStatus: "unavailable",
        "modelLock_gpt-5": "2099-01-01T00:00:00.000Z",
        providerSpecificData: {},
      };
      mocks.getProviderConnectionById.mockResolvedValue(lockedConnection);
      mocks.getUsageForProvider.mockResolvedValue({
        limitReached: false,
        quotas: { session: { used: 5, total: 100, remaining: 95, unlimited: false } },
      });
      mocks.updateProviderConnection.mockResolvedValue({});

      const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
      const response = await GET(
        new Request("http://localhost/api/usage/conn_codex?force=1"),
        { params: Promise.resolve({ connectionId: "conn_codex" }) },
      );

      expect(response.status).toBe(200);
      expect(mocks.updateProviderConnection).toHaveBeenCalledWith("conn_codex", { testStatus: "active" });
    });
  });
});
