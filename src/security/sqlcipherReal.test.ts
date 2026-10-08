/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * sqlcipherReal.test.ts — NIDO: verificación contra SQLCipher REAL.
 *
 * Ejecuta NUESTRAS sentencias SQL (buildKeyPragmaSql, buildAttachEncryptedSql,
 * SQLCIPHER_EXPORT_SQL, DETACH_ENCRYPTED_SQL) contra SQLCipher 4.x de verdad
 * (vía python3 + sqlcipher3) y comprueba:
 *  - la migración ATTACH+sqlcipher_export preserva datos e integridad;
 *  - sqlite3 ESTÁNDAR no puede abrir la base resultante;
 *  - clave incorrecta / sin clave → "file is not a database";
 *  - las strings conocidas del fixture NO aparecen en claro en el fichero.
 *
 * Se omite si python3 o sqlcipher3 no están disponibles.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAttachEncryptedSql,
  buildKeyPragmaSql,
  DETACH_ENCRYPTED_SQL,
  INTEGRITY_CHECK_SQL,
  SQLCIPHER_EXPORT_SQL,
} from "./secureDatabase";

const PY_SCRIPT = `
import sqlcipher3, sqlite3, sys, os

work, key_pragma, attach_sql, export_sql, detach_sql = sys.argv[1:6]
plain = os.path.join(work, "plain.db")
enc = os.path.join(work, "enc.db")
SECRET = "secreto_nido_fixture_987"

# 1. Fixture en claro con strings conocidas.
p = sqlite3.connect(plain)
p.execute("CREATE TABLE msgs(id INTEGER PRIMARY KEY, body TEXT)")
p.execute("INSERT INTO msgs VALUES (1, ?)", (SECRET,))
p.execute("INSERT INTO msgs VALUES (2, 'hola mundo')")
p.execute("CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT)")
p.execute("INSERT INTO kv VALUES ('a', 'b')")
p.commit(); p.close()
before_tables = {"msgs": 2, "kv": 1}

# 2. Migración con NUESTRAS sentencias exactas.
m = sqlcipher3.connect(plain)
m.execute(attach_sql)
m.execute(export_sql)
m.execute(detach_sql)
m.close()

# 3. La cifrada abre con la clave: conteos + integrity.
e = sqlcipher3.connect(enc)
e.execute(key_pragma)
counts = {
    "msgs": e.execute("SELECT count(*) FROM msgs").fetchone()[0],
    "kv": e.execute("SELECT count(*) FROM kv").fetchone()[0],
}
assert counts == before_tables, f"conteos {counts}"
assert e.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert e.execute("SELECT body FROM msgs WHERE id=1").fetchone()[0] == SECRET
cipher_version = e.execute("PRAGMA cipher_version").fetchone()[0]
assert cipher_version, "sin cipher_version"
e.close()

# 4. sqlite3 estándar NO puede abrirla.
try:
    s = sqlite3.connect(enc)
    s.execute("SELECT * FROM msgs").fetchall()
    print("FAIL: sqlite3 estándar abrió la base cifrada")
    sys.exit(10)
except Exception:
    pass

# 5. Clave incorrecta y sin clave fallan.
for bad in ['PRAGMA key = "x\\'%s\\'";' % ("00"*32), None]:
    w = sqlcipher3.connect(enc)
    try:
        if bad: w.execute(bad)
        w.execute("SELECT * FROM msgs").fetchall()
        print("FAIL: abrió con clave incorrecta/ausente")
        sys.exit(11)
    except Exception:
        pass
    finally:
        w.close()

# 6. Ninguna string del fixture en claro en el fichero.
data = open(enc, "rb").read()
for needle in [SECRET.encode(), b"hola mundo", b"CREATE TABLE msgs"]:
    assert needle not in data, f"plaintext residual: {needle!r}"

print("SQLCIPHER_REAL_OK cipher=" + cipher_version)
`;

function sqlcipherAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("python3", ["-c", "import sqlcipher3"], { timeout: 15000 }, (err) =>
      resolve(!err),
    );
  });
}

describe("SQLCipher real", () => {
  it("migración con nuestras sentencias: datos, integridad y sin plaintext", async () => {
    if (!(await sqlcipherAvailable())) {
      console.warn("[sqlcipherReal] python3+sqlcipher3 no disponible: test omitido.");
      return;
    }
    const work = mkdtempSync(join(tmpdir(), "nido-sqlcipher-"));
    try {
      const dekHex = randomBytes(32).toString("hex");
      const enc = join(work, "enc.db");
      const args = [
        "-c",
        PY_SCRIPT,
        work,
        buildKeyPragmaSql(dekHex),
        buildAttachEncryptedSql(enc, dekHex),
        SQLCIPHER_EXPORT_SQL,
        DETACH_ENCRYPTED_SQL,
      ];
      const out = await new Promise<string>((resolve, reject) => {
        execFile("python3", args, { timeout: 60000 }, (err, stdout, stderr) => {
          if (err) reject(new Error(`python falló: ${stderr || err.message}`));
          else resolve(stdout);
        });
      });
      expect(out).toMatch(/SQLCIPHER_REAL_OK cipher=/);
      // La aserción de integridad también viaja en el script; doble check aquí:
      expect(INTEGRITY_CHECK_SQL).toBe("PRAGMA integrity_check;");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 90000);
});
