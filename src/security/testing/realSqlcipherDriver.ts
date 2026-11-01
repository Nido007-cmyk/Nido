/**
 * realSqlcipherDriver.ts — SOLO TESTS (B-01, Pieza II).
 *
 * Driver-puente que deja correr la orquestación TS verdadera
 * (secureDatabase / keyRotation / keyManager) contra el motor SQLCipher
 * REAL, en vez de contra los drivers falsos de la casa. El único motor real
 * disponible en Node es el que sqlcipherReal.test.ts ya usa: python3 +
 * sqlcipher3 (el wheel sqlcipher3-binary). `node:sqlite` es SQLite en claro
 * y expo-sqlite no existe fuera del aparato.
 *
 * Diseño (preparación B-01 §2.2 + ajustes medidos de la sonda Paso 0):
 * - Un proceso `python3 -u puente.py <fichero>` por handle abierto, con UNA
 *   conexión sqlcipher3: el `PRAGMA key` del handshake real es la primera
 *   sentencia y manda sobre esa conexión.
 * - Protocolo JSON por líneas (stdin/stdout, flush por mensaje). Operaciones
 *   seriadas por handle mediante una cadena de promesas: una conexión, en
 *   orden, nunca dos peticiones en vuelo.
 * - exists/remove/rename/writeFile/dbDir van con node:fs sobre un directorio
 *   temporal de verdad.
 * - Timeout por operación (30 s): mata el proceso y convierte el cuelgue en
 *   un rojo legible, nunca en una batería colgada.
 * - El error del motor llega con su mensaje y su clase reales. Las
 *   aserciones deben casar mensaje y estado, nunca la clase.
 * - `PRAGMA rekey` viaja por execAsync desnudo, fuera de
 *   withTransactionAsync (Paso 0, ajuste 2: dentro de un BEGIN este motor
 *   acepta el rekey y consume la transacción).
 * - Parámetros JSON: texto/número/nulo. Los caminos de orquestación
 *   (migración/rotación) no necesitan BLOB; si un camino futuro lo pide,
 *   este driver lanza en vez de codificar en silencio.
 *
 * En el árbol (paso 15) este fichero vive en src/security/testing/ y el
 * puente en la misma carpeta. Nunca entra en el bundle: solo lo importan
 * ficheros *.test.ts.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { SecureDbDriver, SecureDbHandle } from "../secureDatabase";

const OP_TIMEOUT_MS = 30_000;
const PUENTE_PY = path.join(path.dirname(fileURLToPath(import.meta.url)), "puente.py");

interface BridgeReply {
  id: number | null;
  rows?: Array<Record<string, unknown>>;
  row?: Record<string, unknown> | null;
  changes?: number;
  lastInsertRowId?: number;
  ok?: boolean;
  error?: string;
  errorType?: string;
}

/** Un proceso puente vivo = un handle abierto sobre un fichero. */
class BridgeConnection {
  private proc: ChildProcessWithoutNullStreams;
  private chain: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: BridgeReply) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private dead: Error | null = null;

  constructor(dbPath: string) {
    this.proc = spawn("python3", ["-u", PUENTE_PY, dbPath], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.proc.stderr.on("data", () => {
      /* el traceback queda en el error de la operación que lo provocó */
    });
    this.proc.on("error", (e) => this.kill(e));
    this.proc.on("exit", (code) => {
      if (this.pending.size > 0) {
        this.kill(new Error(`puente.py terminó (código ${code}) con operaciones en vuelo`));
      }
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let reply: BridgeReply;
      try {
        reply = JSON.parse(line) as BridgeReply;
      } catch {
        continue;
      }
      if (reply.id == null) continue;
      const p = this.pending.get(reply.id);
      if (p) {
        this.pending.delete(reply.id);
        p.resolve(reply);
      }
    }
  }

  private kill(err: Error): void {
    if (this.dead) return;
    this.dead = err;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    try {
      this.proc.kill("SIGKILL");
    } catch {
      /* ya muerto */
    }
  }

  /** Ejecuta una operación, seriada tras las anteriores del mismo handle. */
  request<T extends BridgeReply>(op: string, sql?: string, params?: unknown[]): Promise<T> {
    const run = async (): Promise<T> => {
      if (this.dead) throw this.dead;
      const id = this.nextId++;
      const reply = await new Promise<BridgeReply>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          const err = new Error(`puente: timeout de ${OP_TIMEOUT_MS} ms en op=${op} (proceso matado)`);
          this.kill(err);
          reject(err);
        }, OP_TIMEOUT_MS);
        this.pending.set(id, {
          resolve: (r) => {
            clearTimeout(timer);
            resolve(r);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        const payload = JSON.stringify({ id, op, sql, params: params ?? [] }) + "\n";
        this.proc.stdin.write(payload, (err) => {
          if (err) {
            this.pending.delete(id);
            clearTimeout(timer);
            reject(err);
          }
        });
      });
      if (reply.error) {
        const err = new Error(reply.error);
        (err as Error & { errorType?: string }).errorType = reply.errorType;
        throw err;
      }
      return reply as T;
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => {});
    return result;
  }

  async close(): Promise<void> {
    try {
      await this.request("close");
    } catch {
      /* si el proceso ya murió, cerrar es no-op */
    }
    try {
      this.proc.kill("SIGKILL");
    } catch {
      /* ya muerto */
    }
  }
}

function assertJsonParams(params?: unknown[]): void {
  if (!params) return;
  for (const p of params) {
    if (p !== null && typeof p !== "string" && typeof p !== "number") {
      throw new Error(
        "realSqlcipherDriver: parámetro no representable en JSON (se esperaba texto/número/nulo); " +
          "los caminos de orquestación no usan BLOB — si esto salta, el driver-puente necesita la extensión base64, no un apaño.",
      );
    }
  }
}

function makeHandle(conn: BridgeConnection): SecureDbHandle {
  const handle: SecureDbHandle = {
    execAsync: async (sql: string) => {
      await conn.request("exec", sql);
    },
    getAllAsync: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      assertJsonParams(params);
      const r = await conn.request<BridgeReply>("all", sql, params);
      return (r.rows ?? []) as T[];
    },
    getFirstAsync: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      assertJsonParams(params);
      const r = await conn.request<BridgeReply>("first", sql, params);
      return (r.row ?? null) as T | null;
    },
    runAsync: async (sql: string, params?: unknown[]) => {
      assertJsonParams(params);
      const r = await conn.request<BridgeReply>("run", sql, params);
      return { lastInsertRowId: r.lastInsertRowId ?? 0, changes: r.changes ?? 0 };
    },
    withTransactionAsync: async (task: () => Promise<void>) => {
      // BEGIN/COMMIT/ROLLBACK sobre la MISMA conexión (la del handle).
      // OJO: PRAGMA rekey NUNCA debe viajar dentro de esta transacción
      // (Paso 0, ajuste 2); producción ya lo cumple — el handle de
      // keyRotation solo expone exec/close.
      await conn.request("begin");
      try {
        await task();
        await conn.request("commit");
      } catch (e) {
        await conn.request("rollback").catch(() => {});
        throw e;
      }
    },
    closeAsync: async () => {
      await conn.close();
    },
  };
  return handle;
}

/**
 * Crea el driver-puente rooted en `dir` (directorio temporal real).
 * `dbDir()` devuelve `dir`; todas las rutas de las bases viven bajo él.
 */
export function makeRealSqlcipherDriver(dir: string): SecureDbDriver {
  fs.mkdirSync(dir, { recursive: true });
  return {
    dbDir: () => dir,
    exists: async (p: string) => fs.existsSync(p),
    remove: async (p: string) => {
      await fs.promises.rm(p, { force: true });
    },
    rename: async (from: string, to: string) => {
      await fs.promises.rename(from, to);
    },
    writeFile: async (p: string, content: string) => {
      await fs.promises.writeFile(p, content, "utf8");
    },
    openDb: async (p: string) => makeHandle(new BridgeConnection(p)),
  };
}

/** Sonda de disponibilidad del motor real (para el skip honesto en local). */
export async function sqlcipherEngineAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("python3", ["-c", "import sqlcipher3"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("exit", (code) => resolve(code === 0));
  });
}
