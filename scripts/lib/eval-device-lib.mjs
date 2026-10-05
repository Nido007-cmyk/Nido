// Pure helpers for scripts/eval-device.mjs: argument parsing, adb output
// parsing and the exact adb commands, as data. Nothing here runs a
// process, so --dry-run and the tests can use it without a phone.

export const DEFAULT_PACKAGE = "team.nido.app";
export const METRO_PORT = 8081;
export const REQUESTS_DIR = "files/eval/requests";

export const USAGE = `usage: npm run eval:device -- [options]

Runs the NIDO evaluation set on a connected Android device and pulls the results.
With no selection, every installed model plus adaptive routing is evaluated.

  --models a,b        only these models (id or a fragment of it, e.g. phi-3.5,qwen2.5-1.5b)
  --adaptive          include adaptive routing (only adaptive if --models is not given)
  --queries x,y       only these query ids or categories (e.g. greeting-1,reasoning)
  --serial SERIAL     device to use when several are connected
  --package NAME      app package (default ${DEFAULT_PACKAGE})
  --out DIR           results directory (default eval-results)
  --timeout-min N     give up after N minutes (default 240)
  --install           build and install the debug app first (npx expo run:android)
  --no-reload         don't reload the app from Metro before the run
  --dry-run           print the commands without running anything
  -h, --help          show this help`;

const list = (v) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function parseArgs(argv) {
  const opts = {
    models: undefined,
    adaptive: false,
    queries: undefined,
    serial: undefined,
    pkg: DEFAULT_PACKAGE,
    out: "eval-results",
    timeoutMin: 240,
    install: false,
    reload: true,
    dryRun: false,
    help: false,
  };
  const valueOf = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--models": opts.models = list(valueOf(i, a)); i++; break;
      case "--adaptive": opts.adaptive = true; break;
      case "--queries": opts.queries = list(valueOf(i, a)); i++; break;
      case "--serial": opts.serial = valueOf(i, a); i++; break;
      case "--package": opts.pkg = valueOf(i, a); i++; break;
      case "--out": opts.out = valueOf(i, a); i++; break;
      case "--timeout-min": {
        const n = Number(valueOf(i, a));
        if (!Number.isFinite(n) || n <= 0) throw new Error("--timeout-min must be a positive number");
        opts.timeoutMin = n;
        i++;
        break;
      }
      case "--install": opts.install = true; break;
      case "--no-reload": opts.reload = false; break;
      case "--dry-run": opts.dryRun = true; break;
      case "-h":
      case "--help": opts.help = true; break;
      default: throw new Error(`unknown option ${a}`);
    }
  }
  if (!/^[a-zA-Z0-9_.]+$/.test(opts.pkg)) throw new Error("--package must be a Java package name");
  return opts;
}

/** Parses `adb devices` output into [{ serial, state }]. */
export function parseAdbDevices(output) {
  return output
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [serial, state] = l.split(/\s+/);
      return { serial, state };
    });
}

/** Picks the device to use, or explains exactly why none can be used. */
export function selectDevice(devices, wanted) {
  if (wanted) {
    const d = devices.find((x) => x.serial === wanted);
    if (!d) return { error: `device ${wanted} is not connected` };
    if (d.state !== "device") return { error: stateHint(d) };
    return { serial: d.serial };
  }
  const ready = devices.filter((d) => d.state === "device");
  if (ready.length === 1) return { serial: ready[0].serial };
  if (ready.length > 1) return { error: `several devices connected (${ready.map((d) => d.serial).join(", ")}); pick one with --serial` };
  if (devices.length) return { error: devices.map(stateHint).join("; ") };
  return { error: "no Android device connected. Plug it in over USB with USB debugging enabled, then check `adb devices`." };
}

function stateHint(d) {
  if (d.state === "unauthorized") return `${d.serial} is unauthorized: unlock the phone and accept the "Allow USB debugging" prompt`;
  if (d.state === "offline") return `${d.serial} is offline: reconnect the cable or run \`adb kill-server\``;
  return `${d.serial} is in state "${d.state}"`;
}

export function newRequestId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").toLowerCase();
  return `req-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export function buildRequest(opts, requestId) {
  const req = { requestId };
  if (opts.models?.length) req.models = opts.models;
  if (opts.adaptive) req.adaptive = true;
  if (opts.queries?.length) req.queries = opts.queries;
  return req;
}

/** Dev-client deep link that (re)loads the JS bundle from Metro over the adb reverse tunnel. */
export function devClientUrl(slug, port = METRO_PORT) {
  return `exp+${slug}://expo-development-client/?url=${encodeURIComponent(`http://localhost:${port}`)}`;
}

const adb = (serial, ...args) => ["adb", "-s", serial, ...args];
// adb shell joins its arguments and hands them to the device's sh, so every
// remote command is built as one string with its own quoting. Every value
// interpolated here is validated or base64-encoded first.
const runAs = (serial, pkg, cmd) => adb(serial, "shell", `run-as ${pkg} ${cmd}`);

export function commands({ serial, pkg, slug, requestId }) {
  const base = `${REQUESTS_DIR}`;
  return {
    devices: ["adb", "devices"],
    packageInstalled: adb(serial, "shell", `pm list packages ${pkg}`),
    packageInfo: adb(serial, "shell", `dumpsys package ${pkg}`),
    install: ["npx", "expo", "run:android", "--no-bundler"],
    reverse: adb(serial, "reverse", `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`),
    writeRequest: (request) => {
      const b64 = Buffer.from(JSON.stringify(request)).toString("base64");
      return runAs(serial, pkg, `sh -c 'umask 077 && mkdir -p ${base} && echo ${b64} | base64 -d > ${base}/pending.json'`);
    },
    reload: adb(serial, "shell", `am start -a android.intent.action.VIEW -d '${devClientUrl(slug)}' ${pkg}`),
    readStatus: adb(serial, "exec-out", `run-as ${pkg} cat ${base}/${requestId}.status.json`),
    readResult: (resultPath) => {
      if (!/^files\/eval\/[A-Za-z0-9._-]+\.jsonl$/.test(resultPath)) throw new Error(`unexpected result path ${resultPath}`);
      return adb(serial, "exec-out", `run-as ${pkg} cat ${resultPath}`);
    },
  };
}

export function isDebuggable(dumpsysOutput) {
  return /pkgFlags=\[[^\]]*\bDEBUGGABLE\b/.test(dumpsysOutput);
}

export function isPackageListed(pmOutput, pkg) {
  return pmOutput.split("\n").some((l) => l.trim() === `package:${pkg}`);
}

export function resultDir(out, date = new Date()) {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${out}/${d}`;
}

export function formatProgress(status) {
  if (!status) return "waiting for the app to pick up the request…";
  if (status.state === "accepted") return `accepted: ${status.configs?.join(", ")} (${status.total} answers)`;
  if (status.state === "running") return `${status.completed}/${status.total} — ${status.current ?? ""}`;
  if (status.state === "done") return `done: ${status.completed} answers${status.stopped ? " (stopped early)" : ""}`;
  if (status.state === "failed") return `failed: ${status.error}`;
  return JSON.stringify(status);
}
