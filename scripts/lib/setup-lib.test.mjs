import { describe, it, expect } from "vitest";
import { androidSdkFromEnv, javaMajor, menuChoice, nodeMajor, parseSha256File, pickReleaseApk } from "./setup-lib.mjs";

describe("setup helpers", () => {
  it("reads Java and Node versions", () => {
    expect(javaMajor('openjdk version "17.0.12" 2024-07-16')).toBe(17);
    expect(javaMajor('java version "1.8.0_392"')).toBe(8);
    expect(javaMajor("command not found")).toBeNull();
    expect(nodeMajor("v24.15.0")).toBe(24);
  });

  it("picks the APK and its checksum from a release", () => {
    const release = {
      tag_name: "v1.0.0",
      assets: [
        { name: "boar-v1.0.0.apk", browser_download_url: "https://x/boar.apk", size: 60e6 },
        { name: "boar-v1.0.0.apk.sha256", browser_download_url: "https://x/boar.apk.sha256", size: 90 },
        { name: "wiki-vital5.sqlite", browser_download_url: "https://x/w.sqlite", size: 2e8 },
      ],
    };
    expect(pickReleaseApk(release)).toEqual({ name: "boar-v1.0.0.apk", url: "https://x/boar.apk", size: 60e6, shaUrl: "https://x/boar.apk.sha256", tag: "v1.0.0" });
    expect(pickReleaseApk({ assets: [] })).toBeNull();
    expect(pickReleaseApk(null)).toBeNull();
  });

  it("parses sha256sum output", () => {
    const h = "a".repeat(64);
    expect(parseSha256File(`${h}  boar.apk\n`)).toBe(h);
    expect(parseSha256File("nope")).toBeNull();
  });

  it("finds the Android SDK and maps menu answers", () => {
    expect(androidSdkFromEnv({ ANDROID_SDK_ROOT: "/sdk" })).toBe("/sdk");
    expect(androidSdkFromEnv({})).toBeNull();
    expect(menuChoice("1")).toBe("install");
    expect(menuChoice(" Q ")).toBe("quit");
    expect(menuChoice("9")).toBeNull();
  });
});
