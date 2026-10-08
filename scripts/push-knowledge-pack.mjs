#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Copies a knowledge pack built by scripts/build-knowledge-pack.mjs onto a
// USB-connected phone running a development build of NIDO, and verifies it.
//
//   npm run pack:push -- build/knowledge-pack/wiki-vital5.sqlite [--serial SERIAL]
//
// The app picks up any valid pack in its corpus/ folder on the next question.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { DEFAULT_PACKAGE, isDebuggable, isPackageListed, parseAdbDevices, selectDevice } from "./lib/eval-device-lib.mjs";

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const adb = (serial, ...args) => execFileSync("adb", ["-s", serial, ...args], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const serialIdx = args.indexOf("--serial");
if (!file || args.includes("--help")) fail("usage: npm run pack:push -- <pack.sqlite> [--serial SERIAL]");
if (!existsSync(file)) fail(`${file} not found`);
const name = basename(file);
if (!/^[a-z0-9][a-z0-9-]*\.sqlite$/.test(name)) fail("pack file names must be lowercase letters, digits or dashes, ending in .sqlite");

const found = selectDevice(parseAdbDevices(execFileSync("adb", ["devices"], { encoding: "utf8" })), serialIdx >= 0 ? args[serialIdx + 1] : undefined);
if (found.error) fail(found.error);
const serial = found.serial;
if (!isPackageListed(adb(serial, "shell", `pm list packages ${DEFAULT_PACKAGE}`), DEFAULT_PACKAGE)) fail(`${DEFAULT_PACKAGE} isn't installed on ${serial}`);
if (!isDebuggable(adb(serial, "shell", `dumpsys package ${DEFAULT_PACKAGE}`))) fail("the installed app isn't a debuggable build; this needs a development build");

const tmp = `/data/local/tmp/${name}`;
console.log(`copying ${name} to ${serial}…`);
execFileSync("adb", ["-s", serial, "push", file, tmp], { stdio: "inherit" });
// The shell user can read /data/local/tmp, the app's run-as user can write its own files: pipe between them.
adb(serial, "shell", `cat ${tmp} | run-as ${DEFAULT_PACKAGE} sh -c 'umask 077; mkdir -p files/corpus && cat > files/corpus/${name}'`);
adb(serial, "shell", `rm -f ${tmp}`);

const local = createHash("sha256").update(readFileSync(file)).digest("hex");
const remote = createHash("sha256")
  .update(execFileSync("adb", ["-s", serial, "exec-out", `run-as ${DEFAULT_PACKAGE} cat files/corpus/${name}`], { maxBuffer: 1024 * 1024 * 1024 }))
  .digest("hex");
if (local !== remote) fail("the copy on the phone doesn't match; try again");
console.log(`✓ ${name} is on the phone (sha256 ${local.slice(0, 16)}…). NIDO searches it from the next question.`);
