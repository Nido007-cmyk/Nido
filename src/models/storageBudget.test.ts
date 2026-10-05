import { describe, it, expect } from "vitest";
import { APP_RESERVE_BYTES, checkStorageForDownload, FREE_SPACE_MARGIN_BYTES } from "./storageBudget";

const GB = 1024 ** 3;
const base = { usedBytes: 4 * GB, reservedBytes: 0, downloadBytes: 5 * GB, alreadyDownloadedBytes: 0, freeDiskBytes: 300 * GB, budgetBytes: 50 * GB };

describe("checkStorageForDownload", () => {
  it("allows a download that fits the budget and the disk", () => {
    const r = checkStorageForDownload(base);
    expect(r).toEqual({ ok: true, projectedBytes: APP_RESERVE_BYTES + 9 * GB });
  });

  it("refuses a download that would pass the 50GB budget", () => {
    const r = checkStorageForDownload({ ...base, usedBytes: 40 * GB, downloadBytes: 10 * GB });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("budget");
    expect(r.ok === false && r.message).toMatch(/50\.0GB storage budget.*10\.0GB download.*51\.0GB/);
  });

  it("counts the full size of other downloads still running", () => {
    // 1GB app reserve + 30 used + 12 reserved: 8 more passes 50GB, 7 more is exactly at the limit.
    expect(checkStorageForDownload({ ...base, usedBytes: 30 * GB, reservedBytes: 12 * GB, downloadBytes: 8 * GB }).ok).toBe(false);
    expect(checkStorageForDownload({ ...base, usedBytes: 30 * GB, reservedBytes: 12 * GB, downloadBytes: 7 * GB }).ok).toBe(true);
  });

  it("refuses when the phone lacks free space, keeping a margin", () => {
    const r = checkStorageForDownload({ ...base, freeDiskBytes: 5 * GB });
    expect(r.ok === false && r.reason).toBe("disk");
    expect(checkStorageForDownload({ ...base, freeDiskBytes: 5 * GB + FREE_SPACE_MARGIN_BYTES }).ok).toBe(true);
  });

  it("only needs free space for the part a paused download hasn't fetched yet", () => {
    expect(checkStorageForDownload({ ...base, freeDiskBytes: 2 * GB, alreadyDownloadedBytes: 4 * GB }).ok).toBe(true);
  });

  it("skips the disk check when free space is unknown", () => {
    expect(checkStorageForDownload({ ...base, freeDiskBytes: null }).ok).toBe(true);
  });
});
