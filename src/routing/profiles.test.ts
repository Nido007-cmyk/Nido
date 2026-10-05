import { describe, it, expect, vi } from "vitest";

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 0,
  getMemoryInfo: () => ({ rssBytes: 0, totalPssBytes: 0 }),
}));

import { resolveModelForRole, buildModelProfiles, AvailableModel } from "./profiles";
import { CatalogModel } from "../models/manifest";

const GB = 1024 * 1024 * 1024;

function model(id: string, sizeBytes: number, roles: string[] = []): CatalogModel {
  return {
    id,
    kind: "llm",
    label: id,
    filename: `models/${id}.gguf`,
    sizeBytes,
    sha256: "",
    sourceUrl: "",
    license: "MIT",
    description: "",
    required: false,
    capabilities: roles.length ? { roles: roles as any } : undefined,
  };
}

const FAST = model("fast-model", 1 * GB, ["fast"]);
const GENERAL = model("general-model", 2.2 * GB, ["general", "reasoning"]);
const UNCAPTURED = model("mystery-model", 1 * GB); // discovered via HF search, no curated roles

describe("resolveModelForRole", () => {
  it("prefers a present user override over the curated match", () => {
    const available: AvailableModel[] = [
      { model: FAST, present: true },
      { model: GENERAL, present: true },
    ];
    const profile = resolveModelForRole("general", available, { general: "fast-model" }, 8 * GB);
    expect(profile.modelId).toBe("fast-model");
    expect(profile.userOverride).toBe(true);
    expect(profile.enabled).toBe(true);
  });

  it("ignores an override for a model that isn't actually downloaded", () => {
    const available: AvailableModel[] = [{ model: GENERAL, present: true }];
    const profile = resolveModelForRole("general", available, { general: "fast-model" }, 8 * GB);
    expect(profile.modelId).toBe("general-model");
    expect(profile.userOverride).toBe(false);
  });

  it("falls back to the curated catalog match when there's no override", () => {
    const available: AvailableModel[] = [
      { model: FAST, present: true },
      { model: GENERAL, present: true },
    ];
    const profile = resolveModelForRole("reasoning", available, {}, 8 * GB);
    expect(profile.modelId).toBe("general-model");
    expect(profile.enabled).toBe(true);
  });

  it("never resolves to a model that isn't present on disk, even if it's in the catalog", () => {
    const available: AvailableModel[] = [{ model: GENERAL, present: false }];
    const profile = resolveModelForRole("general", available, {}, 8 * GB);
    expect(profile.enabled).toBe(false);
    expect(profile.modelId).toBe("");
  });

  it("gracefully falls back to the default active model when no curated match exists for the role", () => {
    const available: AvailableModel[] = [{ model: UNCAPTURED, present: true }];
    const profile = resolveModelForRole("verifier", available, {}, 8 * GB, "mystery-model");
    expect(profile.enabled).toBe(true);
    expect(profile.modelId).toBe("mystery-model");
    expect(profile.userOverride).toBe(false);
  });

  it("returns a disabled profile rather than throwing when nothing is available at all", () => {
    const profile = resolveModelForRole("verifier", [], {}, 8 * GB);
    expect(profile.enabled).toBe(false);
    expect(profile.compatibilityStatus).toBe("unknown");
  });

  it("flags a model whose estimated footprint exceeds device RAM", () => {
    const HUGE = model("huge-model", 10 * GB, ["reasoning"]);
    const available: AvailableModel[] = [{ model: HUGE, present: true }];
    const profile = resolveModelForRole("reasoning", available, {}, 8 * GB);
    expect(profile.compatibilityStatus).toBe("red");
  });
});

describe("buildModelProfiles", () => {
  it("resolves every role the simple preset needs (just 'general')", () => {
    const available: AvailableModel[] = [{ model: GENERAL, present: true }];
    const profiles = buildModelProfiles("simple", available, {}, 8 * GB);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].role).toBe("general");
    expect(profiles[0].enabled).toBe(true);
  });

  it("still returns a (disabled) profile for a required role with nothing available, rather than omitting it", () => {
    const profiles = buildModelProfiles("research", [], {}, 8 * GB);
    const reasoning = profiles.find((p) => p.role === "reasoning");
    expect(reasoning).toBeDefined();
    expect(reasoning!.enabled).toBe(false);
  });

  it("custom preset has no fixed roles", () => {
    const profiles = buildModelProfiles("custom", [{ model: GENERAL, present: true }], {}, 8 * GB);
    expect(profiles).toHaveLength(0);
  });
});
