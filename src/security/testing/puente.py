#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
puente.py — Puente JSON-por-líneas al motor SQLCipher REAL (solo tests, B-01).

Un proceso por handle: UNA conexión `sqlcipher3` sobre el fichero dado en
argv[1]. Protocolo: una petición JSON por línea en stdin, una respuesta JSON
por línea en stdout, con flush por mensaje.

  Petición : {"id": n, "op": "exec|all|first|run|begin|commit|rollback|close",
              "sql": "...", "params": [...]}
  Respuesta: {"id": n, "rows": [...]}                       (all)
             {"id": n, "row": {...} | null}                 (first)
             {"id": n, "changes": int, "lastInsertRowId": int}  (run)
             {"id": n, "ok": true}                           (exec/begin/commit/rollback/close)
             {"id": n, "error": "...", "errorType": "..."}  (fallo del motor, tal cual)

Semántica (medida en la sonda Paso 0, nido-prep-b01-paso0-rekey-2026-11-01):
- isolation_level=None (autocommit): espejo de la fachada expo-sqlite fuera de
  withTransactionAsync. begin/commit/rollback son sentencias explícitas sobre
  la MISMA conexión.
- El error del motor viaja con su mensaje y su clase reales: las aserciones de
  la suite casan MENSAJE y ESTADO, nunca la clase de la excepción (el motor
  habla con DatabaseError, OperationalError y hasta un MemoryError vacío en la
  conexión envenenada tras un rekey con clave no verificada).
- PRAGMA rekey va SIEMPRE por "exec" desnudo, fuera de toda transacción
  (dentro de un BEGIN este motor lo acepta y CONSUME la transacción: el COMMIT
  posterior lanzaría después de que la rotación ya aterrizó).
"""
import json
import sys

import sqlcipher3


def main() -> None:
    path = sys.argv[1]
    conn = sqlcipher3.connect(path)
    conn.isolation_level = None  # autocommit; transacciones explícitas por op
    conn.row_factory = sqlcipher3.Row
    out = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:  # protocolo roto: responder y seguir
            out.write(json.dumps({"id": None, "error": str(e), "errorType": type(e).__name__}) + "\n")
            out.flush()
            continue
        rid = req.get("id")
        op = req.get("op")
        try:
            if op == "close":
                conn.close()
                out.write(json.dumps({"id": rid, "ok": True}) + "\n")
                out.flush()
                return
            if op == "begin":
                conn.execute("BEGIN")
                resp = {"id": rid, "ok": True}
            elif op == "commit":
                conn.execute("COMMIT")
                resp = {"id": rid, "ok": True}
            elif op == "rollback":
                conn.execute("ROLLBACK")
                resp = {"id": rid, "ok": True}
            elif op == "exec":
                conn.execute(req["sql"], req.get("params") or [])
                resp = {"id": rid, "ok": True}
            elif op == "all":
                cur = conn.execute(req["sql"], req.get("params") or [])
                resp = {"id": rid, "rows": [dict(r) for r in cur.fetchall()]}
            elif op == "first":
                cur = conn.execute(req["sql"], req.get("params") or [])
                row = cur.fetchone()
                resp = {"id": rid, "row": dict(row) if row is not None else None}
            elif op == "run":
                cur = conn.execute(req["sql"], req.get("params") or [])
                resp = {
                    "id": rid,
                    "changes": cur.rowcount if cur.rowcount is not None else 0,
                    "lastInsertRowId": cur.lastrowid or 0,
                }
            else:
                resp = {"id": rid, "error": "op desconocida: %s" % op, "errorType": "ProtocolError"}
        except Exception as e:
            resp = {"id": rid, "error": str(e), "errorType": type(e).__name__}
        out.write(json.dumps(resp) + "\n")
        out.flush()


if __name__ == "__main__":
    main()
