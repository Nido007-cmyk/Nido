#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Guided setup: `make setup` (or `node scripts/setup.mjs`). Asks what you want
// and walks you through it: install the app on a phone, build it from source,
// run developer mode over USB, or build a knowledge pack. Uses only Node's
// built-in modules, so it runs before `npm install`.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { androidSdkFromEnv, javaMajor, MENU, menuChoice, nodeMajor } from "./lib/setup-lib.mjs";
import { parseAdbDevices, selectDevice } from "./lib/eval-device-lib.mjs";

const rl = createInterface({ input: process.stdin, terminal: false });
// Buffered, so answers piped in ahead of the questions (scripts, tests) aren't lost.
const lines = rl[Symbol.asyncIterator]();
const say = (s = "") => console.log(s);
const ok = (s) => say(`  ✓ ${s}`);
const warn = (s) => say(`  ! ${s}`);
const ask = async (q, def = "") => {
  process.stdout.write(`${q}${def ? ` [${def}]` : ""} `);
  const { value, done } = await lines.next();
  if (done) {
    say("");
    throw new Error("no more input");
  }
  if (!process.stdin.isTTY) say(value);
  return value.trim() || def;
};
const yes = async (q, def = "y") => /^y/i.test(await ask(`${q} (y/n)`, def));

function run(cmd, args, opts = {}) {
  say(`\n$ ${[cmd, ...args].join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  return r.status === 0;
}
function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.error ? null : `${r.stdout ?? ""}${r.stderr ?? ""}`;
}
const has = (cmd) => capture(cmd, ["--version"]) !== null || capture(cmd, ["version"]) !== null;

// ---------- checks ----------

function checkNode() {
  const major = nodeMajor(process.version);
  if (major < 20) {
    warn(`Node.js ${process.version} is too old; install Node 20 or newer from https://nodejs.org`);
    return false;
  }
  ok(`Node.js ${process.version}`);
  return true;
}

function ensureNpmInstall() {
  if (existsSync("node_modules/expo")) {
    ok("npm dependencies installed");
    return true;
  }
  say("  Installing npm dependencies (a few minutes the first time)…");
  return run("npm", ["install"]);
}

function checkAdb() {
  if (!has("adb")) {
    warn("adb (Android platform-tools) isn't installed.");
    say("    Install it: https://developer.android.com/tools/releases/platform-tools");
    say("    (Linux: `sudo apt install adb` or `sudo dnf install android-tools`; macOS: `brew install android-platform-tools`)");
    return false;
  }
  ok("adb found");
  return true;
}

async function connectPhone() {
  say("\nConnect your phone with a USB cable:");
  say("  1. On the phone: Settings → About phone → tap \"Build number\" 7 times to unlock Developer options.");
  say("  2. Settings → Developer options → turn on \"USB debugging\".");
  say("  3. Plug in the cable and accept \"Allow USB debugging\" on the phone.");
  for (;;) {
    await ask("Press Enter when the phone is connected…");
    const found = selectDevice(parseAdbDevices(capture("adb", ["devices"]) ?? ""));
    if (found.serial) {
      ok(`phone ${found.serial} connected`);
      return found.serial;
    }
    warn(found.error);
    if (!(await yes("Try again?"))) return null;
  }
}

function checkJava() {
  const out = capture("java", ["-version"]);
  const major = javaMajor(out);
  if (!major) {
    warn("No JDK found. Install JDK 17: https://adoptium.net (or it comes with Android Studio).");
    return false;
  }
  if (major < 17) {
    warn(`Java ${major} found; the Android build needs JDK 17 or newer.`);
    return false;
  }
  ok(`Java ${major}`);
  return true;
}

function checkAndroidSdk() {
  const sdk = androidSdkFromEnv(process.env);
  if (sdk && existsSync(sdk)) {
    ok(`Android SDK at ${sdk}`);
    return true;
  }
  warn("No Android SDK found (ANDROID_HOME isn't set).");
  say("    Easiest: install Android Studio (https://developer.android.com/studio), open it once to");
  say("    download the SDK, then add to your shell profile:");
  say("      export ANDROID_HOME=$HOME/Android/Sdk        # macOS: $HOME/Library/Android/sdk");
  say("      export PATH=$ANDROID_HOME/platform-tools:$PATH");
  say("    Or skip all of this and use the cloud build instead.");
  return false;
}

// ---------- flows ----------

async function installFlow() {
  say("\nInstall NIDO on your phone");
  say("--------------------------");
  const apk = await ask("Path to an APK you already have:");
  if (!apk) {
    // NIDO has no official release download yet, and this wizard must not
    // present another project's APK (previously: rferrari/boar-app) as a
    // NIDO install. Fail honestly instead of downloading the wrong app.
    warn("No APK path given — and NIDO publishes no official release APK to download yet.");
    say('    Build one from this source instead: run `make setup` again and choose "Build the app from source".');
    return;
  }
  if (!existsSync(apk)) return warn(`${apk} not found.`);

  const how = await ask("Install over a USB cable (1) or copy it to the phone yourself (2)?", "1");
  if (how === "2") {
    say(`\n  Copy ${apk} to the phone (cable, cloud drive, Nearby Share…), open it in the Files app,`);
    say("  allow installing from that app when Android asks, and tap Install.");
  } else {
    if (!checkAdb()) return;
    const serial = await connectPhone();
    if (!serial) return;
    if (!run("adb", ["-s", serial, "install", "-r", apk])) return warn("Install failed; see the message above.");
    ok("NIDO installed");
  }
  say("\n  Open NIDO on the phone. The first launch downloads the default model (about 1 GB) once;");
  say("  after that it works fully offline.");
}

async function buildFlow() {
  say("\nBuild the app from source");
  say("-------------------------");
  if (!checkNode() || !ensureNpmInstall()) return;
  say("\n  1) Cloud build with EAS: no Android SDK needed, needs a free Expo account (expo.dev).");
  say("  2) Local build: needs JDK 17+ and the Android SDK on this computer.");
  const how = await ask("Which one?", "1");
  if (how === "1") {
    say("\n  Log in to Expo (a browser window may open), then the build runs in the cloud.");
    if (!run("npx", ["eas-cli", "login"])) return;
    if (!run("npx", ["eas-cli", "build", "--platform", "android", "--profile", "preview"])) return;
    say("\n  When it finishes, EAS prints a link to the APK. Run `make setup` → \"Install NIDO on my phone\"");
    say("  with the downloaded file to install it.");
    return;
  }
  const java = checkJava();
  const sdk = checkAndroidSdk();
  if (!java || !sdk) return say("\n  Install what's missing above and run `make setup` again, or use the cloud build.");
  if (!run("npx", ["expo", "prebuild", "-p", "android"])) return;
  if (!run("./gradlew", ["assembleRelease"], { cwd: "android" })) return;
  const apk = "android/app/build/outputs/apk/release/app-release.apk";
  if (!existsSync(apk)) return warn(`Build finished but ${apk} wasn't found.`);
  const sha = createHash("sha256").update(readFileSync(apk)).digest("hex");
  ok(`APK built: ${apk} (${(statSync(apk).size / 1e6).toFixed(0)} MB, sha256 ${sha.slice(0, 16)}…)`);
  if (await yes("Install it on a phone over USB now?")) {
    if (!checkAdb()) return;
    const serial = await connectPhone();
    if (serial && run("adb", ["-s", serial, "install", "-r", apk])) ok("NIDO installed");
  }
}

async function devFlow() {
  say("\nDeveloper mode (USB, live reload)");
  say("---------------------------------");
  if (!checkNode() || !ensureNpmInstall()) return;
  const java = checkJava();
  const sdk = checkAndroidSdk();
  if (!java || !sdk || !checkAdb()) return say("\n  Install what's missing above and run `make setup` again.");
  const serial = await connectPhone();
  if (!serial) return;
  say("\n  Building and installing the development build (several minutes the first time)…");
  if (!run("npx", ["expo", "run:android", "--device"], { env: { ...process.env, ANDROID_SERIAL: serial } })) return;
  ok("development build installed");
  say("\n  Next time, keep `make start` running in a terminal (it serves the code over USB),");
  say("  then open NIDO on the phone. Benchmark models with `npm run eval:device` (docs/DEVICE_EVALUATION.md).");
}

async function packFlow() {
  say("\nBuild an offline knowledge pack");
  say("-------------------------------");
  if (!checkNode() || !ensureNpmInstall()) return;
  say("  1) Wikipedia Vital Articles level 4: ~10k articles, about 30 minutes");
  say("  2) Wikipedia Vital Articles level 5: ~50k articles, a few hours");
  say("  3) Your own list of Wikipedia article titles (one per line in a text file)");
  const which = await ask("Which one?", "1");
  if (!["1", "2", "3"].includes(which)) return warn("Please choose 1, 2 or 3.");
  const args = which === "2" ? [] : which === "3" ? ["--titles", await ask("Path to your titles file:")] : ["--level", "4"];
  const time = which === "2" ? "a few hours" : "about 30 minutes for 10k articles";
  if (!(await yes(`This needs an internet connection and takes ${time} (it resumes if interrupted). Start now?`))) return;
  if (!run("npm", ["run", "pack:build", "--", ...args])) return;
  say("\n  Copy it to a phone running a development build with `npm run pack:push -- <file>`;");
  say("  see docs/KNOWLEDGE_PACKS.md to ship it with the app.");
}

async function main() {
  say("\nNIDO setup");
  say("==========");
  say("An offline AI research app for Android. What would you like to do?\n");
  for (const m of MENU) say(`  ${m.key}) ${m.label}`);
  const choice = menuChoice(await ask("\nChoose", "1"));
  if (choice === "install") await installFlow();
  else if (choice === "build") await buildFlow();
  else if (choice === "dev") await devFlow();
  else if (choice === "pack") await packFlow();
  else if (choice !== "quit") warn("Please choose one of the numbers above.");
  rl.close();
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  rl.close();
  process.exit(1);
});
