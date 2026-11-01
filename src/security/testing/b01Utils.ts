/**
 * b01Utils.ts — SOLO TESTS (B-01). Ayudantes compartidos de las suites
 * de motor real que vivían solo dentro de b01Fire.test.ts y que la
 * suite de migración también necesita; subidos aquí sin cambiar su
 * comportamiento (paso 6 de B-01).
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { expect } from "vitest";

const execFileAsync = promisify(execFile);

const registeredRoots: string[] = [];

/** Directorio temporal fresco para una suite de motor real; se registra para limpieza. */
export function freshDir(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nido-b01-${tag}-`));
  registeredRoots.push(dir);
  return dir;
}

/** Borra todos los directorios creados con freshDir en esta suite. */
export function cleanupFreshDirs(): void {
  for (const dir of registeredRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** sqlite3 ESTÁNDAR (el de Python, sin SQLCipher) debe rechazar el fichero. */
export async function expectPlainSqliteRejects(file: string, sentinel: string): Promise<void> {
  const script =
    "import sqlite3,sys\n" +
    "try:\n" +
    "    c=sqlite3.connect(sys.argv[1])\n" +
    "    c.execute('SELECT count(*) FROM sqlite_master')\n" +
    "    print('ABRIO-EN-CLARO')\n" +
    "except Exception as e:\n" +
    "    print('RECHAZA:', e)\n";
  const { stdout } = await execFileAsync("python3", ["-c", script, file]);
  expect(stdout).toContain("RECHAZA:");
  const bytes = fs.readFileSync(file);
  expect(bytes.includes(Buffer.from(sentinel, "utf8"))).toBe(false);
  expect(bytes.subarray(0, 16).toString("latin1")).not.toContain("SQLite format 3");
}
