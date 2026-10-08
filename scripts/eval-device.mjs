#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Runs the NIDO evaluation set on a connected Android device and pulls the
// results back: `npm run eval:device -- --help`. Transport only: the
// evaluation itself runs inside the app (src/eval/), triggered by a request
// file this script writes over adb. See docs/EVAL_QUERIES.md.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  USAGE,
  buildRequest,
  commands,
  formatProgress,
  isDebuggable,
  isPackageListed,
  newRequestId,
  parseAdbDevices,
  parseArgs,
  resultDir,
  selectDevice,
  METRO_PORT,
} from "./lib/eval-device-lib.mjs";
import { formatAnswers, formatReport, parseRows } from "./lib/eval-report.mjs";

const POLL_MS = 5000;
// Picking up the request needs the app loaded and its models ready.
const PICKUP_TIMEOUT_MS = 5 * 60 * 1000;

const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};
const show = (argv) => argv.map((a) => (/[\s'"&?]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");

function run(argv, { allowFail = false } = {}) {
  try {
    return execFileSync(argv[0], argv.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    if (allowFail) return null;
    throw new Error(`${show(argv)} failed: ${(e.stderr || e.message || "").toString().trim()}`);
  }
}

async function metroRunning() {
  try {
    const res = await fetch(`http://localhost:${METRO_PORT}/status`, { signal: AbortSignal.timeout(3000) });
    return (await res.text()).includes("packager-status:running");
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    process.exit(1);
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  const slug = JSON.parse(readFileSync("app.json", "utf8")).expo.slug;
  const requestId = newRequestId();
  const request = buildRequest(opts, requestId);

  if (opts.dryRun) {
    const cmd = commands({ serial: opts.serial ?? "<serial>", pkg: opts.pkg, slug, requestId });
    console.log("Dry run — commands that would be executed, in order:\n");
    const steps = [
      ["check device", cmd.devices],
      ["check package", cmd.packageInstalled],
      ...(opts.install ? [["build + install debug app", cmd.install]] : [["(only if the package is missing) build + install", cmd.install]]),
      ["check debuggable", cmd.packageInfo],
      ["check Metro", ["GET", `http://localhost:${METRO_PORT}/status`]],
      ["tunnel Metro", cmd.reverse],
      ["write request", cmd.writeRequest(request)],
      ...(opts.reload ? [["reload app from Metro", cmd.reload]] : []),
      [`poll every ${POLL_MS / 1000}s`, cmd.readStatus],
      ["pull result", cmd.readResult("files/eval/RUNID.jsonl")],
    ];
    for (const [label, argv] of steps) console.log(`# ${label}\n${show(argv)}\n`);
    console.log(`request: ${JSON.stringify(request)}`);
    console.log(`results: ${resultDir(opts.out)}/<runId>.jsonl`);
    return;
  }

  // 1. Device
  const found = selectDevice(parseAdbDevices(run(["adb", "devices"])), opts.serial);
  if (found.error) fail(found.error);
  const cmd = commands({ serial: found.serial, pkg: opts.pkg, slug, requestId });
  console.log(`✓ device ${found.serial}`);

  // 2. App installed (and debuggable, which run-as needs)
  let installed = isPackageListed(run(cmd.packageInstalled), opts.pkg);
  if (!installed || opts.install) {
    console.log(`… ${installed ? "reinstalling" : `${opts.pkg} not installed, building and installing`} the debug app (npx expo run:android --no-bundler)`);
    const r = spawnSync(cmd.install[0], cmd.install.slice(1), { stdio: "inherit", env: { ...process.env, ANDROID_SERIAL: found.serial } });
    if (r.status !== 0) fail("building/installing the debug app failed");
    installed = isPackageListed(run(cmd.packageInstalled), opts.pkg);
    if (!installed) fail(`${opts.pkg} still not installed after the build`);
  }
  if (!isDebuggable(run(cmd.packageInfo))) {
    fail(`${opts.pkg} is not a debuggable build, so its files can't be read with run-as. Install a debug/dev-client build (npm run eval:device -- --install).`);
  }
  console.log(`✓ ${opts.pkg} installed (debuggable)`);

  // 3. Metro, reachable from the phone over USB
  if (!(await metroRunning())) {
    fail(`Metro isn't running on localhost:${METRO_PORT}. Start it in another terminal with \`make start\` (or \`npx expo start --localhost\`) and retry.`);
  }
  run(cmd.reverse);
  console.log(`✓ Metro running, adb reverse tcp:${METRO_PORT} set`);

  // 4. Request, then (re)load the app so it runs the current code
  run(cmd.writeRequest(request));
  console.log(`✓ request ${requestId} written: ${JSON.stringify(request)}`);
  if (opts.reload) {
    run(cmd.reload);
    console.log("✓ app reloading from Metro");
  }

  // 5. Wait
  const start = Date.now();
  const deadline = start + opts.timeoutMin * 60 * 1000;
  let last = "";
  let status = null;
  while (true) {
    const text = run(cmd.readStatus, { allowFail: true });
    status = null;
    if (text) {
      try {
        status = JSON.parse(text);
      } catch {
        // mid-write; try again next poll
      }
    }
    const line = formatProgress(status);
    if (line !== last) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`  [${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}] ${line}`);
      last = line;
    }
    if (status?.state === "done") break;
    if (status?.state === "failed") {
      fail(`${status.error}${status.installedModels ? `\n  installed models: ${status.installedModels.join(", ")}` : ""}`);
    }
    if (!status && Date.now() - start > PICKUP_TIMEOUT_MS) {
      fail("the app didn't pick up the request within 5 minutes. Is it open on the chat screen with its models loaded (and Metro serving it)?");
    }
    if (Date.now() > deadline) fail(`timed out after ${opts.timeoutMin} minutes; the run may still be going on the phone`);
    await sleep(POLL_MS);
  }

  // 6. Pull, save, report
  // exec-out exits 0 even when the remote cat fails, printing the error instead.
  const jsonl = run(cmd.readResult(status.resultPath));
  const rows = parseRows(jsonl);
  if (rows.length === 0) fail(`could not read ${status.resultPath} from the device: ${jsonl.trim().slice(0, 200)}`);
  const dir = resultDir(opts.out);
  mkdirSync(dir, { recursive: true });
  const resultFile = join(dir, `${status.runId}.jsonl`);
  const answersFile = join(dir, `${status.runId}.answers.md`);
  writeFileSync(resultFile, jsonl.endsWith("\n") ? jsonl : `${jsonl}\n`);
  writeFileSync(answersFile, `${formatAnswers(rows)}\n`);
  writeFileSync(join(dir, `${status.runId}.status.json`), `${JSON.stringify(status, null, 2)}\n`);

  console.log(`\n${formatReport(rows)}\n`);
  console.log(`Raw results (authoritative): ${resultFile}`);
  console.log(`Answers for grading:         ${answersFile}`);
}

main().catch((e) => fail(e.message));
