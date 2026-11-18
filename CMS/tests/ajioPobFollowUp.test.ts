import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * After an AJIO login is saved, the POBs are fetched — but only for an account
 * that has none stored. Re-sweeping one that already has a list would cost a
 * paged API read on every capture.
 */

const credentialFor = vi.fn();
const sweepAjioPobs = vi.fn();
const apiRequest = vi.fn();
const broadcast = vi.fn();

vi.mock("@main/services/company.service", () => ({
  credentialFor: credentialFor,
  orderedPobIds: (pobs: { id: string }[]) => pobs.map((pob) => pob.id),
  refreshCompany: vi.fn(() => Promise.resolve()),
}));
vi.mock("@main/services/session.store", () => ({
  getAccessToken: () => "token",
}));
vi.mock("@main/services/httpClient", () => ({
  apiRequest: apiRequest,
}));
vi.mock("@main/services/automationLock", () => ({
  withAutomationLock: (_name: string, work: () => Promise<unknown>) => work(),
}));
vi.mock("@main/automations/platforms/ajio/common/pobSync", () => ({
  sweepAjioPobs: sweepAjioPobs,
}));
vi.mock("@main/ipc/broadcast", () => ({
  broadcast: broadcast,
}));
vi.mock("@main/services/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { syncMissingAjioPobs } =
  await import("@main/services/ajioPobSync.service");

describe("syncMissingAjioPobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("leaves an account that already has POBs alone", async () => {
    credentialFor.mockResolvedValue({ pobIds: [{ id: "DV1" }] });

    const result = await syncMissingAjioPobs("seller@example.com");

    expect(result.success).toBe(true);
    expect(sweepAjioPobs).not.toHaveBeenCalled();
  });

  it("fetches and stores the POBs when none are stored, then tells the Login page", async () => {
    credentialFor.mockResolvedValue({ pobIds: [] });
    sweepAjioPobs.mockResolvedValue({
      pobIds: ["DV1", "DV2"],
      storeCount: 2,
      source: "work-places",
      enterpriseLevel: false,
    });
    apiRequest.mockResolvedValue({
      success: true,
      data: {
        username: "seller@example.com",
        pobIds: ["DV1", "DV2"],
        added: 2,
        removed: 0,
      },
    });

    const result = await syncMissingAjioPobs(" seller@example.com ");

    expect(result.success).toBe(true);
    expect(sweepAjioPobs).toHaveBeenCalledWith("seller@example.com");
    expect(apiRequest).toHaveBeenCalledWith(
      "/cms/ajio/sync-pobs",
      expect.objectContaining({
        body: { username: "seller@example.com", pobIds: ["DV1", "DV2"] },
      }),
    );
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("reports a sweep that found nothing without storing it", async () => {
    credentialFor.mockResolvedValue(null);
    sweepAjioPobs.mockResolvedValue({
      pobIds: [],
      storeCount: 0,
      source: "work-places",
      enterpriseLevel: false,
    });

    const result = await syncMissingAjioPobs("seller@example.com");

    expect(result.success).toBe(false);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("stores the POBs the login read, without opening a browser to sweep", async () => {
    credentialFor.mockResolvedValue({
      pobIds: [],
      session: { pobIds: ["DV1", " DV2 ", "DV1", ""] },
    });
    apiRequest.mockResolvedValue({
      success: true,
      data: { username: "seller@example.com", pobIds: ["DV1", "DV2"], added: 2, removed: 0 },
    });

    const result = await syncMissingAjioPobs("seller@example.com");

    expect(result.success).toBe(true);
    expect(sweepAjioPobs).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith(
      "/cms/ajio/sync-pobs",
      expect.objectContaining({
        body: { username: "seller@example.com", pobIds: ["DV1", "DV2"] },
      }),
    );
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("sweeps an Enterprise account rather than trusting the login's work-places list", async () => {
    credentialFor.mockResolvedValue({
      pobIds: [],
      isEnterpriseLevel: true,
      session: { pobIds: ["DV1"] },
    });
    sweepAjioPobs.mockResolvedValue({
      pobIds: ["DV1", "DV9"],
      storeCount: 2,
      source: "pobsFromUserId",
      enterpriseLevel: true,
    });
    apiRequest.mockResolvedValue({
      success: true,
      data: { username: "seller@example.com", pobIds: ["DV1", "DV9"], added: 2, removed: 0 },
    });

    const result = await syncMissingAjioPobs("seller@example.com");

    expect(result.success).toBe(true);
    expect(sweepAjioPobs).toHaveBeenCalledWith("seller@example.com");
  });

  it("falls back to a sweep when storing the login's POBs is refused", async () => {
    credentialFor.mockResolvedValue({ pobIds: [], session: { pobIds: ["DV1"] } });
    sweepAjioPobs.mockResolvedValue({
      pobIds: ["DV1"],
      storeCount: 1,
      source: "work-places",
      enterpriseLevel: false,
    });
    apiRequest
      .mockResolvedValueOnce({ success: false, error: { code: "NETWORK_ERROR", message: "offline" } })
      .mockResolvedValueOnce({
        success: true,
        data: { username: "seller@example.com", pobIds: ["DV1"], added: 1, removed: 0 },
      });

    const result = await syncMissingAjioPobs("seller@example.com");

    expect(result.success).toBe(true);
    expect(sweepAjioPobs).toHaveBeenCalledOnce();
  });
});
