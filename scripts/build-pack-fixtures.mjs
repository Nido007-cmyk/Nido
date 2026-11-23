/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * build-pack-fixtures.mjs — construye los fixtures de bytes reales de
 * la puerta de paquetes (auditoría de la 0.1.110, §6.1; cura 0.1.111).
 *
 * Las suites `packImport · real store bytes` y `packImporter · the
 * door with real store bytes` dormían en CI: los ZIP de tienda viven
 * fuera del repo (~/workspace/your_files/salvora-packs) y el ZIP de
 * SALVORA es un producto de pago que NO puede entrar en el repo.
 * Este script deja en src/models/fixtures/ una pareja con la misma
 * fuerza de prueba para la corrida que publica:
 *
 * - salvora-emergencias-casa-edicion-2026-11.zip: un pack de BANCO
 *   pequeño (2 guías, 30 fragmentos de texto de prueba, >100 KB por
 *   edición: un caso de la suite trunca a 100.000 bytes) con el
 *   esquema v2 exacto de producción, firmado con la clave REAL de
 *   SALVORA PACKS. La puerta lo acepta por la firma de verdad, no por una
 *   costura de test. La clave privada se lee de
 *   ~/workspace/user/keystores/salvora-manifest-sign.key (o de
 *   $SALVORA_SIGN_KEY), nunca se imprime ni se copia: el script
 *   deriva la pública y ABORTA si no es la pineada en
 *   src/models/packImport.ts. Sin la clave, este paso no se puede
 *   rehacer: el ZIP ya construido es lo que se comitea.
 * - salvora-esencial-edicion-2026-11.zip: copia verbatim del ZIP de
 *   tienda del Esencial (pack gratuito; sus dos .sqlite son los del
 *   catálogo de NIDO, con pin en src/models/manifest.ts). Su origen
 *   «nido» se prueba por pin de catálogo, así que ningún juguete
 *   puede sustituirlo: han de ser los bytes reales. Si el ZIP de
 *   tienda está presente, el script lo copia y verifica los dos
 *   sha256 contra los pines del catálogo antes de copiar.
 *
 * Uso: node scripts/build-pack-fixtures.mjs [--skip-esencial]
 */
import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nacl = require("tweetnacl");

const PINNED_PUBLIC_KEY_B64 = "HfH4rO39agZVzybigFmWW1PPjqwb9bAFZBHkMqz/sHQ=";
// Los pines del catálogo (src/models/manifest.ts, entradas del
// Esencial): el fixture del Esencial solo vale si casa con ellos.
const ESENCIAL_PINS = {
  "nido-esencial.sqlite": "b57fa32a3849a0edda89c84b96f2eab526489df195a168e59f8536fc78fd5d60",
  "nido-esencial-e5.sqlite": "c4d49aa945199520af9273cf5fd02f52d26eda7f82b1c41c65f121a635706c92",
};
const EMB_SHA = {
  std: "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
  e5: "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde",
};

const FIXTURES_DIR = join(process.cwd(), "src/models/fixtures");
const STORE_DIR = join(homedir(), "workspace/your_files/salvora-packs");
const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

// ---------------------------------------------------------------------------
// El pack de banco: esquema v2 exacto, contenido de prueba declarado.
// ---------------------------------------------------------------------------

function buildToyPack(path, variant) {
  const e5 = variant === "e5";
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE meta (key TEXT, value TEXT);
    CREATE TABLE chunks (id INTEGER, title TEXT, body TEXT, source TEXT, scale REAL, vec BLOB, guide INTEGER, keys TEXT);
    CREATE TABLE guides (id INTEGER, key TEXT, lang TEXT, title TEXT, category TEXT, region TEXT, sources TEXT, verified TEXT);
    CREATE TABLE regions (code TEXT, names TEXT, aliases TEXT, phrases TEXT);
    CREATE TABLE facts (id INTEGER, region TEXT, key TEXT, value TEXT, label TEXT, note TEXT, source_title TEXT, source_url TEXT, quote TEXT, checked TEXT);
  `);
  const meta = {
    format: "nido-knowledge-pack",
    formatVersion: "2",
    id: e5 ? "salvora-emergencias-casa-e5" : "salvora-emergencias-casa",
    name: "SALVORA Home Emergencies — TEST FIXTURE (not the store pack)",
    source: "Test fixture built by scripts/build-pack-fixtures.mjs for the pack-door suites. Toy content, real signature.",
    license: "NIDO test fixture (MIT repository). Not the SALVORA PACKS store product.",
    articles: "2",
    chunks: "30",
    facts: "0",
    dims: "384",
    embeddingModelSha256: e5 ? EMB_SHA.e5 : EMB_SHA.std,
  };
  const insMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(meta)) insMeta.run(k, v);
  const insGuide = db.prepare(
    "INSERT INTO guides (id, key, lang, title, category, region, sources, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  insGuide.run(1, "fixture-fire", "en", "Test fixture: what this file is", "fixture", "", "NIDO test suite", "2026-11-23");
  insGuide.run(2, "fixture-water", "en", "Test fixture: second guide", "fixture", "", "NIDO test suite", "2026-11-23");
  const vec = Buffer.alloc(384 * 4); // 384 float32 en cero: la puerta no juzga el contenido del vector.
  const insChunk = db.prepare(
    "INSERT INTO chunks (id, title, body, source, scale, vec, guide, keys) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  // 30 fragmentos con cuerpo: el pack de banco ha de pasar de
  // 100.000 bytes, porque un caso de la suite trunca la copia a
  // 100.000 y espera otro hash — con un juguete más pequeño la
  // «truncada» sería el fichero entero y el caso no probaría nada.
  const sentence =
    "This is test content for the pack import door, written only so the fixture has the shape and size of a real pack. It carries no real guidance. ";
  const body = sentence.repeat(28).trim();
  for (let i = 1; i <= 30; i++) {
    insChunk.run(i, `Fixture chunk ${i}`, body, "fixture", 1.0, vec, i % 2 === 0 ? 2 : 1, "fixture test");
  }
  db.close();
  return readFileSync(path);
}

// ---------------------------------------------------------------------------
// Firma: la forma canónica de packImport.ts (sin los campos de firma,
// claves ordenadas, JSON sin espacios) — la misma del firmador de la
// tienda (sign-salvora-manifest.mjs).
// ---------------------------------------------------------------------------

const SIGN_FIELDS = ["signedBy", "signingPublicKey", "signature", "signedAt"];
function canonicalJSON(manifest) {
  const clean = {};
  for (const k of Object.keys(manifest).filter((k) => !SIGN_FIELDS.includes(k)).sort()) clean[k] = manifest[k];
  return JSON.stringify(clean);
}

function loadSigner() {
  const keyPath = process.env.SALVORA_SIGN_KEY ?? join(homedir(), "workspace/user/keystores/salvora-manifest-sign.key");
  if (!existsSync(keyPath)) {
    throw new Error(`No se encontró la clave de firma (${keyPath}). El fixture firmado no se puede reconstruir sin ella.`);
  }
  const key = createPrivateKey(readFileSync(keyPath));
  const spki = createPublicKey(key).export({ type: "spki", format: "der" });
  const rawPublic = Buffer.from(spki).subarray(spki.length - 32);
  if (rawPublic.toString("base64") !== PINNED_PUBLIC_KEY_B64) {
    throw new Error("La clave no deriva la pública pineada en packImport.ts. Abortado: no se firma nada.");
  }
  return key;
}

function signManifest(key, manifest) {
  const sig = cryptoSign(null, Buffer.from(canonicalJSON(manifest), "utf8"), key);
  // Autocomprobación con la misma librería que usa la puerta.
  const ok = nacl.sign.detached.verify(
    new TextEncoder().encode(canonicalJSON(manifest)),
    new Uint8Array(sig),
    new Uint8Array(Buffer.from(PINNED_PUBLIC_KEY_B64, "base64")),
  );
  if (!ok) throw new Error("La firma recién hecha no verifica contra la clave pineada. Abortado.");
  return Buffer.from(sig).toString("base64");
}

// ---------------------------------------------------------------------------
// ZIP mínimo (entradas stored): el lector de las suites lee stored y
// deflate; stored basta y no depende de niveles de compresión.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

/** Lector ZIP mínimo (stored + deflate, por el directorio central). */
function zipRead(buf) {
  const { inflateRawSync } = require("node:zlib");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP sin directorio central.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Entrada central inválida.");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const localNameLen = buf.readUInt16LE(localAt + 26);
    const localExtraLen = buf.readUInt16LE(localAt + 28);
    const dataAt = localAt + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataAt, dataAt + (method === 8 ? buf.readUInt32LE(p + 16) : size));
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------------------

function main() {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const key = loadSigner();
  const entries = [];
  for (const variant of ["std", "e5"]) {
    const file = variant === "e5" ? "salvora-emergencias-casa-e5.sqlite" : "salvora-emergencias-casa.sqlite";
    const tmp = join(tmpdir(), `.pack-fixture-${variant}-${process.pid}.sqlite`);
    const bytes = buildToyPack(tmp, variant);
    const manifest = {
      id: variant === "e5" ? "salvora-emergencias-casa-e5" : "salvora-emergencias-casa",
      file,
      sizeBytes: bytes.length,
      sha256: sha256Hex(bytes),
      articles: 2,
      chunks: 30,
      signedBy: "SALVORA PACKS",
      signingPublicKey: PINNED_PUBLIC_KEY_B64,
      signedAt: new Date().toISOString(),
      signature: "",
    };
    manifest.signature = signManifest(key, manifest);
    entries.push({ name: file, data: bytes });
    entries.push({ name: `${file}.json`, data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8") });
    console.log(`fixture ${variant}: ${file} (${bytes.length} B, sha ${manifest.sha256.slice(0, 12)}…) firmado y verificado`);
  }
  const out = join(FIXTURES_DIR, "salvora-emergencias-casa-edicion-2026-11.zip");
  writeFileSync(out, zipStore(entries));
  console.log(`escrito ${out}`);

  if (!process.argv.includes("--skip-esencial")) {
    const storeZip = join(STORE_DIR, "salvora-esencial-edicion-2026-11.zip");
    if (existsSync(storeZip)) {
      // Antes de copiar, los dos .sqlite han de casar con los pines
      // del catálogo: si la tienda reedita el Esencial y el catálogo
      // aún no lo sigue (o al revés), el fixture no se refresca en
      // silencio con bytes que la puerta rechazaría.
      const entries = zipRead(readFileSync(storeZip));
      for (const [name, pin] of Object.entries(ESENCIAL_PINS)) {
        const data = entries.get(name);
        if (!data) throw new Error(`El ZIP del Esencial no contiene ${name}.`);
        if (sha256Hex(data) !== pin) {
          throw new Error(`${name} no casa con el pin del catálogo (${pin.slice(0, 12)}…). Fixture no refrescado.`);
        }
      }
      copyFileSync(storeZip, join(FIXTURES_DIR, "salvora-esencial-edicion-2026-11.zip"));
      console.log("fixture esencial: copia verbatim del ZIP de tienda (gratuito), pines verificados, en fixtures/");
    } else {
      console.log("fixture esencial: el ZIP de tienda no está presente; no se toca el fixture existente.");
    }
  }
}

main();
