/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import {
  APP_RESERVE_BYTES,
  FREE_SPACE_MARGIN_BYTES,
  checkStorageForDownload,
} from "./storageBudget";

const GB = 1024 ** 3;
const base = {
  usedBytes: 4 * GB,
  reservedBytes: 0,
  downloadBytes: 5 * GB,
  alreadyDownloadedBytes: 0,
  freeDiskBytes: 300 * GB,
  budgetBytes: 50 * GB,
};

describe("checkStorageForDownload — boundary and corrupt-input edges", () => {
  it("allows a download that lands exactly on the budget (boundary is inclusive)", () => {
    const downloadBytes = 50 * GB - APP_RESERVE_BYTES - 4 * GB; // projected == budget
    const r = checkStorageForDownload({ ...base, downloadBytes });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.projectedBytes).toBe(50 * GB);
  });

  it("refuses a download one byte over the budget", () => {
    const downloadBytes = 50 * GB - APP_RESERVE_BYTES - 4 * GB + 1;
    const r = checkStorageForDownload({ ...base, downloadBytes });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("budget");
  });

  it("allows free space exactly at stillNeeded + margin (boundary is inclusive)", () => {
    const stillNeeded = 5 * GB;
    const r = checkStorageForDownload({
      ...base,
      freeDiskBytes: stillNeeded + FREE_SPACE_MARGIN_BYTES,
    });
    expect(r.ok).toBe(true);
  });

  it("refuses free space one byte under stillNeeded + margin", () => {
    const r = checkStorageForDownload({
      ...base,
      freeDiskBytes: 5 * GB + FREE_SPACE_MARGIN_BYTES - 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disk");
  });

  it("clamps a corrupt partial (alreadyDownloaded > size) to zero still-needed", () => {
    // A partial file larger than the manifest size must not produce a
    // negative stillNeeded that skips the disk check entirely.
    const r = checkStorageForDownload({
      ...base,
      downloadBytes: 5 * GB,
      alreadyDownloadedBytes: 9 * GB,
      freeDiskBytes: FREE_SPACE_MARGIN_BYTES, // only margin free
    });
    expect(r.ok).toBe(true);
  });

  it("allows a zero-byte asset", () => {
    expect(checkStorageForDownload({ ...base, downloadBytes: 0 }).ok).toBe(true);
  });

  it("a fully-resumed download (nothing left) only needs the margin free", () => {
    const r = checkStorageForDownload({
      ...base,
      alreadyDownloadedBytes: 5 * GB,
      freeDiskBytes: FREE_SPACE_MARGIN_BYTES,
    });
    expect(r.ok).toBe(true);
  });
});
