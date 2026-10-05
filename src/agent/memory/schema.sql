-- NIDO — esquema de memoria persistente.
-- La base se abre con SQLCipher: PRAGMA key = <clave del Android Keystore>.
-- Sin la clave, este archivo es indistinguible de ruido.

CREATE TABLE IF NOT EXISTS facts (
  id         TEXT PRIMARY KEY,          -- uuid
  content    TEXT NOT NULL,             -- el hecho, en tus palabras
  category   TEXT NOT NULL DEFAULT 'general',  -- general | preference | goal | event
  confidence REAL NOT NULL DEFAULT 1.0,
  source     TEXT,                      -- 'user' | 'inferred'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS preferences (
  key        TEXT PRIMARY KEY,          -- p.ej. 'language', 'tone'
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  relationship TEXT,                    -- p.ej. 'amigo', 'familia'
  notes        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_log (
  id         TEXT PRIMARY KEY,
  day        TEXT NOT NULL,             -- YYYY-MM-DD
  entry      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_log_day ON daily_log(day);

-- NIDO agent: notas y recordatorios de las herramientas locales.
-- Viven en la misma base cifrada que la memoria.
CREATE TABLE IF NOT EXISTS agent_notes (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agent_reminders (
  id         TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  due_at     TEXT,                       -- ISO-8601; NULL = sin fecha
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON agent_reminders(due_at) WHERE done = 0;

-- Borrado total ("derecho al olvido" local): basta con borrar el archivo
-- de la base y la clave del Keystore. Nada existe en ningún otro lugar.
