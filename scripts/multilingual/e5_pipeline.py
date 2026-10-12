#!/usr/bin/env python3
# MIT License
# Copyright (c) 2026 NIDO contributors
# See LICENSE file for details.
"""
Multilingual search pipeline (docs/design/BUSQUEDA_MULTILINGUE.md).

Runs in GitHub Actions (.github/workflows/multilingual-e5.yml) against
llama-server built from the SAME llama.cpp commit that llama.rn vendors, so
the embeddings measured here are the ones the phone computes.

  parity     GGUF (via llama-server) vs the original model (sentence-transformers):
             token ids and cosine per text. Fails if Q8_0 drifts (< --min-cos).
  calibrate  Semantic search filter, simulated exactly as the app runs it
             (absolute floor + margin prune + per-title cap + 4 answer chunks),
             for bge-small-en (today) and multilingual-e5-small, over the
             built-in corpus and the Wikipedia Vital pack. Sweeps the floors and
             writes a JSON + Markdown report with the recommended values.
  build-pack Vital pack v2: same text, vectors re-embedded with e5 ("passage: ").

Nothing here is used by the app at runtime.
"""

import argparse
import concurrent.futures as cf
import hashlib
import json
import math
import os
import shutil
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime, timezone

import numpy as np

DIMS = 384
E5_QUERY = "query: "
E5_PASSAGE = "passage: "
# App constants (src/rag/pure.ts, src/rag/retrieve.ts) - the baseline.
APP_MIN_SIM = 0.60
APP_MIN_SIM_SINGLE = 0.70
APP_MARGIN = 0.4
APP_SOURCE_LIMIT = 12  # topK * 2
APP_TOPK = 6
APP_MAX_PER_TITLE = 2
APP_ANSWER_CHUNKS = 4
LANGS = ("es", "en", "pt")


def log(msg):
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- server I/O


def _post(url, payload, timeout=600):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _normalize(m):
    m = np.asarray(m, dtype=np.float32)
    n = np.linalg.norm(m, axis=1, keepdims=True)
    n[n == 0] = 1
    return m / n


def embed(base, texts, batch=32, workers=4, progress_every=0):
    """L2-normalized float32 (n, DIMS) from llama-server /v1/embeddings."""
    out = np.zeros((len(texts), DIMS), dtype=np.float32)
    starts = list(range(0, len(texts), batch))
    done = 0
    t0 = time.time()

    def work(s):
        res = _post(f"{base}/v1/embeddings", {"input": texts[s : s + batch], "model": "nido"})
        vecs = sorted(res["data"], key=lambda d: d["index"])
        return s, [d["embedding"] for d in vecs]

    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for s, vecs in ex.map(work, starts):
            arr = np.asarray(vecs, dtype=np.float32)
            if arr.shape != (min(batch, len(texts) - s), DIMS):
                raise SystemExit(f"unexpected embedding shape {arr.shape}")
            out[s : s + len(vecs)] = arr
            done += len(vecs)
            if progress_every and (done // progress_every) != ((done - len(vecs)) // progress_every):
                rate = done / max(time.time() - t0, 1e-6)
                log(f"  {done}/{len(texts)} ({rate:.0f}/s, ~{(len(texts) - done) / rate / 60:.0f} min left)")
    return _normalize(out)


def embed_resumable(base, texts, block_dir, block=10000):
    """embed() in blocks saved to disk, so a cancelled run resumes where it stopped."""
    os.makedirs(block_dir, exist_ok=True)
    parts = []
    t0 = time.time()
    for b, s in enumerate(range(0, len(texts), block)):
        f = os.path.join(block_dir, f"{b:04d}-{len(texts)}.npy")
        if os.path.exists(f):
            parts.append(np.load(f))
            continue
        arr = embed(base, texts[s : s + block], batch=32, workers=4)
        np.save(f + ".tmp.npy", arr)
        os.replace(f + ".tmp.npy", f)
        parts.append(arr)
        done = s + len(arr)
        log(f"  vital e5 {done}/{len(texts)} ({(time.time() - t0) / 60:.1f} min this run)")
    return np.concatenate(parts, axis=0) if parts else np.zeros((0, DIMS), np.float32)


def tokenize(base, text):
    return _post(f"{base}/tokenize", {"content": text, "add_special": True})["tokens"]


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


# ------------------------------------------------------------------- corpus


def load_builtin(paths):
    docs = []
    for p in paths:
        with open(p, encoding="utf-8") as f:
            for d in json.load(f):
                docs.append({"title": d["title"], "text": f"{d['title']}\n{d['body']}"})
    return docs


def load_vital(path):
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    rows = con.execute("SELECT id, title, body, vec FROM chunks ORDER BY id").fetchall()
    meta = dict(con.execute("SELECT key, value FROM meta").fetchall())
    con.close()
    ids = np.array([r[0] for r in rows], dtype=np.int64)
    titles = [r[1] for r in rows]
    texts = [f"{r[1]}\n{r[2]}" for r in rows]
    vec = np.frombuffer(b"".join(r[3] for r in rows), dtype=np.int8).reshape(len(rows), DIMS)
    return ids, titles, texts, vec, meta


def quantize_int8(m):
    """Mirror of scripts/lib/knowledge-pack-lib.mjs quantizeInt8 (Math.round = floor(x + 0.5))."""
    m = np.asarray(m, dtype=np.float32)
    mx = np.abs(m).max(axis=1)
    scale = np.where(mx > 0, mx / np.float32(127), np.float32(1)).astype(np.float32)
    q = np.floor(m / scale[:, None] + 0.5).astype(np.int8)
    return q, scale


def int8_unit(q):
    """cosineSimilarityInt8 == dot with the int8 vector normalized."""
    return _normalize(q.astype(np.float32))


# --------------------------------------------------------------- simulation


class Ranked:
    """One query against one source: every score sorted (for the floor and the
    margin, which looks at the LOWEST gated score) plus the top indices."""

    __slots__ = ("desc", "top")

    def __init__(self, scores, keep=64):
        order = np.argsort(-scores, kind="stable")
        self.desc = scores[order].astype(np.float32)
        self.top = order[:keep]

    def count_at_least(self, x):
        # desc is descending: count of values >= x
        return int(np.searchsorted(-self.desc, -x, side="right"))


def source_search(r, floor, margin, min_keep=1):
    """semanticSearch / searchPacks: floor, then pruneByScoreMargin, then limit."""
    n = r.count_at_least(floor)
    if n == 0:
        return []
    k = n
    if n > min_keep:
        mx, mn = float(r.desc[0]), float(r.desc[n - 1])
        rng = mx - mn
        if rng > 1e-9:
            k = max(r.count_at_least(mx - margin * rng), min_keep)
    k = min(k, APP_SOURCE_LIMIT)
    return [(float(r.desc[i]), int(r.top[i])) for i in range(k)]


def _floor_for(floor, src):
    """A floor is one number for every source, or {source: number} (packs get a higher one)."""
    return floor[src] if isinstance(floor, dict) else floor


def app_answer_titles(sources, titles_by_source, floor, margin):
    """Union of sources -> fusion order (semantic only) -> per-title cap -> answer chunks."""
    cands = []
    for src, scores in sources.items():
        for sc, i in source_search(scores, _floor_for(floor, src), margin):
            cands.append((sc, titles_by_source[src][i]))
    if not cands:
        return [], 0.0
    # Fusion normalizes semantic scores by the max of the merged list; order == raw order.
    cands.sort(key=lambda c: -c[0])
    per, out = {}, []
    for sc, t in cands:
        k = t.strip().lower()
        if per.get(k, 0) >= APP_MAX_PER_TITLE:
            continue
        per[k] = per.get(k, 0) + 1
        out.append((sc, t))
        if len(out) >= APP_TOPK:
            break
    # Final gate after fusion: the model's base floor (the lowest of them).
    final = min(floor.values()) if isinstance(floor, dict) else floor
    out = [c for c in out if c[0] >= final]
    return [t for _, t in out[:APP_ANSWER_CHUNKS]], cands[0][0]


def load_queries(path):
    q = json.load(open(path, encoding="utf-8"))
    items = []
    for kind in ("answerable", "singleTerm", "unanswerable"):
        for it in q[kind]:
            for lang in LANGS:
                items.append(
                    {
                        "kind": kind,
                        "lang": lang,
                        "q": it[lang],
                        "expect": [t.lower() for t in it.get("expect", [])],
                        "single": len(it[lang].split()) <= 1,
                    }
                )
    return items


def evaluate(items, qscores, titles_by_source, floor_multi, floor_single, margin):
    """Per-language recall@4 (answerable) and false-accept rate (no answer in corpus)."""
    stats = {lang: {"ans": 0, "hit": 0, "neg": 0, "fa": 0} for lang in LANGS}
    for it, sources in zip(items, qscores):
        floor = floor_single if it["single"] else floor_multi
        got, _ = app_answer_titles(sources, titles_by_source, floor, margin)
        st = stats[it["lang"]]
        if it["expect"]:
            st["ans"] += 1
            st["hit"] += int(any(t.lower() in it["expect"] for t in got))
        else:
            st["neg"] += 1
            st["fa"] += int(len(got) > 0)
    res = {}
    for lang, st in stats.items():
        res[lang] = {
            "recall": st["hit"] / st["ans"] if st["ans"] else None,
            "falseAccept": st["fa"] / st["neg"] if st["neg"] else None,
            "answerable": st["ans"],
            "unanswerable": st["neg"],
        }
    rec = [res[l]["recall"] for l in LANGS if res[l]["recall"] is not None]
    fa = [res[l]["falseAccept"] for l in LANGS if res[l]["falseAccept"] is not None]
    res["mean"] = {"recall": float(np.mean(rec)) if rec else None, "falseAccept": float(np.mean(fa)) if fa else None}
    return res


def top1_distribution(items, qscores):
    """Best raw cosine per query, split by answerable / unanswerable and language."""
    out = {}
    for it, sources in zip(items, qscores):
        best = max(float(s.desc[0]) for s in sources.values())
        key = f"{'pos' if it['expect'] else 'neg'}_{it['lang']}"
        out.setdefault(key, []).append(best)
    return {k: {"p10": float(np.percentile(v, 10)), "p50": float(np.percentile(v, 50)), "p90": float(np.percentile(v, 90)), "min": float(min(v)), "max": float(max(v))} for k, v in sorted(out.items())}


def choose(items, qscores, titles_by_source, base_fa_multi, base_fa_single, margin):
    """Floors that maximize mean recall without more false accepts than today's bge setup."""
    grid = [round(x, 3) for x in np.arange(0.40, 0.961, 0.005)]
    multi_items = [i for i, it in enumerate(items) if not it["single"]]
    single_items = [i for i, it in enumerate(items) if it["single"]]

    def sweep(idx, single, base_fa):
        rows = []
        for f in grid:
            sub_items = [items[i] for i in idx]
            sub_scores = [qscores[i] for i in idx]
            ev = evaluate(sub_items, sub_scores, titles_by_source, f, f, margin)
            rows.append({"floor": f, **ev})
        ok = [r for r in rows if (r["mean"]["falseAccept"] or 0) <= base_fa + 1e-9]
        best = None
        if ok:
            top = max(r["mean"]["recall"] or 0 for r in ok)
            # among equally good floors, the highest (most conservative)
            best = max((r for r in ok if (r["mean"]["recall"] or 0) >= top - 1e-9), key=lambda r: r["floor"])
        return rows, best

    multi_rows, multi_best = sweep(multi_items, False, base_fa_multi)
    single_rows, single_best = sweep(single_items, True, base_fa_single)
    return multi_rows, multi_best, single_rows, single_best


# ------------------------------------------------------------------ commands


def cmd_parity(a):
    from sentence_transformers import SentenceTransformer
    from transformers import AutoTokenizer

    q = json.load(open(a.queries, encoding="utf-8"))
    texts = []
    for it in q["answerable"][:12] + q["unanswerable"][:4]:
        for lang in LANGS:
            texts.append(E5_QUERY + it[lang])
    for d in load_builtin(a.corpus)[:24]:
        texts.append(E5_PASSAGE + d["text"])
    texts.append(E5_PASSAGE + "Ñandú, pingüino, coração, ação, São Paulo, Žižek — 東京 — émoji 🙂")

    st = SentenceTransformer(a.st_dir, device="cpu")
    ref = st.encode(texts, normalize_embeddings=True, batch_size=16, convert_to_numpy=True)
    tok = AutoTokenizer.from_pretrained(a.st_dir)

    report = {"texts": len(texts), "servers": {}}
    ok = True
    for name, base in (("q8_0", a.server_q8), ("f16", a.server_f16)):
        got = embed(base, texts, batch=8, workers=2)
        cos = np.sum(got * ref, axis=1)
        mism = []
        for t in texts:
            a_ids, b_ids = tokenize(base, t), tok(t)["input_ids"]
            if a_ids != b_ids:
                mism.append({"text": t[:80], "llama": a_ids[:24], "hf": b_ids[:24]})
        report["servers"][name] = {
            "cosMin": float(cos.min()),
            "cosMean": float(cos.mean()),
            "tokenMismatches": len(mism),
            "tokenMismatchSamples": mism[:5],
        }
        log(f"{name}: cos min {cos.min():.5f} mean {cos.mean():.5f}, token mismatches {len(mism)}/{len(texts)}")
    if report["servers"]["q8_0"]["cosMin"] < a.min_cos:
        ok = False
    report["minCosRequired"] = a.min_cos
    report["pass"] = ok
    json.dump(report, open(a.out, "w"), indent=2)
    if not ok:
        raise SystemExit("parity FAILED (see report)")


def cmd_calibrate(a):
    items = load_queries(a.queries)
    builtin = load_builtin(a.corpus)
    log(f"built-in corpus: {len(builtin)} docs; queries: {len(items)}")
    b_titles = [d["title"] for d in builtin]

    vital = None
    if a.vital:
        ids, v_titles, v_texts, v_bge_q, v_meta = load_vital(a.vital)
        log(f"vital pack: {len(ids)} chunks")
        vital = {"ids": ids, "titles": v_titles, "texts": v_texts, "bge": int8_unit(v_bge_q)}

    # ---- passages
    log("bge: built-in passages")
    b_bge = embed(a.bge, [d["text"] for d in builtin])
    log("e5: built-in passages")
    b_e5 = embed(a.e5, [E5_PASSAGE + d["text"] for d in builtin])
    if vital is not None:
        v_e5 = embed_resumable(a.e5, [E5_PASSAGE + t for t in vital["texts"]], os.path.join(a.cache_dir, f"vital-e5-{a.e5_sha[:16]}"))
        if v_e5.shape != (len(vital["ids"]), DIMS):
            raise SystemExit(f"vital e5 cache shape {v_e5.shape} != {(len(vital['ids']), DIMS)}")
        np.save(os.path.join(a.cache_dir, "vital-e5-latest.npy"), v_e5)
        # The pack stores int8: score against what the phone will read.
        vital["e5_q"], vital["e5_scale"] = quantize_int8(v_e5)
        vital["e5"] = int8_unit(vital["e5_q"])

    # ---- queries
    log("queries")
    qb = embed(a.bge, [it["q"] for it in items])
    qe = embed(a.e5, [E5_QUERY + it["q"] for it in items])

    def scores_for(model, with_vital):
        q = qb if model == "bge" else qe
        builtin_m = b_bge if model == "bge" else b_e5
        per_q = []
        sb = q @ builtin_m.T
        sv = (q @ vital[model].T) if (with_vital and vital is not None) else None
        for i in range(len(items)):
            s = {"builtin": Ranked(sb[i])}
            if sv is not None:
                s["vital"] = Ranked(sv[i])
            per_q.append(s)
        return per_q

    titles_by_source = {"builtin": b_titles}
    if vital is not None:
        titles_by_source["vital"] = vital["titles"]

    pools = {"builtin": False}
    if vital is not None:
        pools["builtin+vital"] = True

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "llamaCppCommit": a.llama_commit,
        "e5": {"repo": a.e5_repo, "revision": a.e5_revision, "ggufSha256": a.e5_sha},
        "bge": {"ggufSha256": a.bge_sha},
        "appBaseline": {"minSim": APP_MIN_SIM, "minSimSingle": APP_MIN_SIM_SINGLE, "margin": APP_MARGIN},
        "pools": {},
    }
    for pool, with_vital in pools.items():
        log(f"pool {pool}")
        sb = scores_for("bge", with_vital)
        se = scores_for("e5", with_vital)
        tbs = {k: v for k, v in titles_by_source.items() if with_vital or k == "builtin"}
        # Today's behaviour: bge with the app's floors.
        multi = [i for i, it in enumerate(items) if not it["single"]]
        single = [i for i, it in enumerate(items) if it["single"]]
        base_multi = evaluate([items[i] for i in multi], [sb[i] for i in multi], tbs, APP_MIN_SIM, APP_MIN_SIM, APP_MARGIN)
        base_single = evaluate([items[i] for i in single], [sb[i] for i in single], tbs, APP_MIN_SIM_SINGLE, APP_MIN_SIM_SINGLE, APP_MARGIN)
        # e5 with bge's floors: why per-model floors are needed.
        e5_at_bge = evaluate([items[i] for i in multi], [se[i] for i in multi], tbs, APP_MIN_SIM, APP_MIN_SIM, APP_MARGIN)
        entry = {
            "bgeToday": {"multi": base_multi, "single": base_single},
            "e5AtBgeFloors": {"multi": e5_at_bge},
            "top1": {"bge": top1_distribution(items, sb), "e5": top1_distribution(items, se)},
            "e5": {},
            "bgeRetuned": {},
        }
        for margin in (0.3, 0.4, 0.5):
            mr, mb, sr, sbst = choose(items, se, tbs, base_multi["mean"]["falseAccept"], base_single["mean"]["falseAccept"], margin)
            entry["e5"][str(margin)] = {"multiBest": mb, "singleBest": sbst, "multiSweep": mr[::4], "singleSweep": sr[::4]}
        mr, mb, sr, sbst = choose(items, sb, tbs, base_multi["mean"]["falseAccept"], base_single["mean"]["falseAccept"], APP_MARGIN)
        entry["bgeRetuned"] = {"multiBest": mb, "singleBest": sbst}
        # The configuration the app ships (src/rag/embeddingProfile.ts):
        # built-in floor + a higher floor for packs (a 116k-chunk pack always
        # has *something* close; more candidates need more evidence).
        bm, bs, pm, ps = a.app_floors
        fm = {"builtin": bm, "vital": pm}
        fs = {"builtin": bs, "vital": ps}
        entry["e5App"] = {
            "floors": {"builtin": [bm, bs], "packs": [pm, ps]},
            "multi": evaluate([items[i] for i in multi], [se[i] for i in multi], tbs, fm, fm, APP_MARGIN),
            "single": evaluate([items[i] for i in single], [se[i] for i in single], tbs, fs, fs, APP_MARGIN),
        }
        if with_vital:
            sweep = []
            for pf in [round(x, 3) for x in np.arange(0.81, 0.871, 0.005)]:
                f2 = {"builtin": bm, "vital": pf}
                sweep.append({"packFloor": pf, **evaluate([items[i] for i in multi], [se[i] for i in multi], tbs, f2, f2, APP_MARGIN)})
            entry["e5PackFloorSweep"] = sweep
        report["pools"][pool] = entry

    json.dump(report, open(a.out, "w"), indent=2)
    with open(a.md, "w", encoding="utf-8") as f:
        f.write(render_md(report))
    log(f"report: {a.out}, {a.md}")


def _pct(x):
    return "—" if x is None else f"{100 * x:.0f}%"


def render_md(r):
    L = [
        "# Calibración búsqueda multilingüe (generado)",
        "",
        f"- Generado: {r['generatedAt']}",
        f"- llama.cpp: `{r['llamaCppCommit']}` (el de llama.rn)",
        f"- e5: `{r['e5']['repo']}@{r['e5']['revision']}`, GGUF sha256 `{r['e5']['ggufSha256']}`",
        f"- bge GGUF sha256 `{r['bge']['ggufSha256']}`",
        f"- Filtro de la app hoy: piso {r['appBaseline']['minSim']}, una palabra {r['appBaseline']['minSimSingle']}, margen {r['appBaseline']['margin']}",
        "",
        "Recall = la pregunta trae el artículo correcto entre los 4 fragmentos que ve el modelo.",
        "Falsos = preguntas sin respuesta en el corpus que aun así traen fragmentos.",
        "Solo búsqueda por significado (la de palabras va aparte y no cambia).",
        "",
    ]
    for pool, e in r["pools"].items():
        L += [f"## Corpus: {pool}", "", "| | es recall | en recall | pt recall | falsos (media) |", "|---|---|---|---|---|"]

        def row(name, ev):
            return f"| {name} | {_pct(ev['es']['recall'])} | {_pct(ev['en']['recall'])} | {_pct(ev['pt']['recall'])} | {_pct(ev['mean']['falseAccept'])} |"

        L.append(row("bge hoy (frases)", e["bgeToday"]["multi"]))
        L.append(row("e5 con pisos de bge", e["e5AtBgeFloors"]["multi"]))
        for m, x in e["e5"].items():
            b = x["multiBest"]
            if b:
                L.append(row(f"e5 piso {b['floor']} margen {m}", b))
        if e.get("e5App"):
            fl = e["e5App"]["floors"]
            L.append(row(f"**e5 en la app** (integrado {fl['builtin'][0]}, paquetes {fl['packs'][0]})", e["e5App"]["multi"]))
        if e["bgeRetuned"]["multiBest"]:
            b = e["bgeRetuned"]["multiBest"]
            L.append(row(f"bge re-ajustado piso {b['floor']}", b))
        L += ["", "Una sola palabra:", "", "| | es | en | pt | falsos |", "|---|---|---|---|---|"]
        L.append(row("bge hoy", e["bgeToday"]["single"]))
        if e.get("e5App"):
            fl = e["e5App"]["floors"]
            L.append(row(f"**e5 en la app** (integrado {fl['builtin'][1]}, paquetes {fl['packs'][1]})", e["e5App"]["single"]))
        for m, x in e["e5"].items():
            b = x["singleBest"]
            if b:
                L.append(row(f"e5 piso {b['floor']} margen {m}", b))
        if e.get("e5PackFloorSweep"):
            L += ["", "Piso de los paquetes (frases; integrado fijo):", "", "| piso | es | en | pt | falsos |", "|---|---|---|---|---|"]
            for r in e["e5PackFloorSweep"]:
                L.append(row(str(r["packFloor"]), r))
        L += ["", "Mejor coseno por pregunta (p10 / p50 / p90):", "", "| | bge | e5 |", "|---|---|---|"]
        for k in e["top1"]["e5"]:
            bb, ee = e["top1"]["bge"][k], e["top1"]["e5"][k]
            L.append(f"| {k} | {bb['p10']:.3f} / {bb['p50']:.3f} / {bb['p90']:.3f} | {ee['p10']:.3f} / {ee['p50']:.3f} / {ee['p90']:.3f} |")
        L.append("")
    return "\n".join(L) + "\n"


def cmd_build_pack(a):
    v = np.load(a.e5_vectors)
    shutil.copyfile(a.src, a.out)
    con = sqlite3.connect(a.out)
    ids = [r[0] for r in con.execute("SELECT id FROM chunks ORDER BY id")]
    if len(ids) != v.shape[0]:
        raise SystemExit(f"{len(ids)} chunks but {v.shape[0]} vectors")
    q, scale = quantize_int8(v)
    con.execute("BEGIN")
    con.executemany(
        "UPDATE chunks SET vec = ?, scale = ? WHERE id = ?",
        ((q[i].tobytes(), float(scale[i]), ids[i]) for i in range(len(ids))),
    )
    meta = {
        "id": a.id,
        "name": a.name,
        "embeddingModelSha256": a.e5_sha,
        "embeddingModel": f"{a.e5_repo}@{a.e5_revision}",
        "embeddingPassagePrefix": E5_PASSAGE,
        "embeddingQueryPrefix": E5_QUERY,
        # Fixed (not "now") so a rebuild from the same inputs is byte-identical
        # and keeps the SHA-256 pinned in the signed catalog.
        "builtAt": a.built_at,
        "derivedFrom": a.src_sha,
        # The text is Wikipedia's (CC BY-SA 4.0); ShareAlike means the pack as
        # a whole stays CC BY-SA 4.0. Attribution covers both Wikipedia and
        # NIDO as the compiler of this adapted work.
        "license": "CC BY-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        "attribution": (
            "Compiled by NIDO (https://github.com/Nido007-cmyk/Nido) from Wikipedia article "
            "introductions (https://www.wikipedia.org, CC BY-SA 4.0). Vectors computed by NIDO with "
            "intfloat/multilingual-e5-small (MIT). If you share or adapt this pack, credit NIDO and "
            "Wikipedia, link the license, say what you changed, and keep CC BY-SA 4.0."
        ),
        "compiledBy": "NIDO - https://github.com/Nido007-cmyk/Nido",
    }
    con.executemany("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", meta.items())
    con.commit()
    con.execute("VACUUM")
    con.close()
    # Sanity: what the app reads back equals what we wrote.
    con = sqlite3.connect(f"file:{a.out}?mode=ro", uri=True)
    back = np.frombuffer(b"".join(r[0] for r in con.execute("SELECT vec FROM chunks ORDER BY id")), dtype=np.int8).reshape(-1, DIMS)
    con.close()
    if not np.array_equal(back, q):
        raise SystemExit("pack read-back mismatch")
    summary = {"id": a.id, "file": os.path.basename(a.out), "sizeBytes": os.path.getsize(a.out), "sha256": sha256_file(a.out), "chunks": len(ids)}
    json.dump(summary, open(a.out + ".json", "w"), indent=2)
    log(json.dumps(summary))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    pp = sub.add_parser("parity")
    pp.add_argument("--server-q8", required=True)
    pp.add_argument("--server-f16", required=True)
    pp.add_argument("--st-dir", required=True)
    pp.add_argument("--queries", required=True)
    pp.add_argument("--corpus", nargs="+", required=True)
    pp.add_argument("--min-cos", type=float, default=0.99)
    pp.add_argument("--out", required=True)

    pc = sub.add_parser("calibrate")
    pc.add_argument("--bge", required=True)
    pc.add_argument("--e5", required=True)
    pc.add_argument("--queries", required=True)
    pc.add_argument("--corpus", nargs="+", required=True)
    pc.add_argument("--vital")
    pc.add_argument("--cache-dir", required=True)
    pc.add_argument("--e5-sha", required=True)
    pc.add_argument("--e5-repo", required=True)
    pc.add_argument("--e5-revision", required=True)
    pc.add_argument("--bge-sha", required=True)
    pc.add_argument("--llama-commit", required=True)
    pc.add_argument("--out", required=True)
    pc.add_argument("--md", required=True)
    pc.add_argument(
        "--app-floors",
        type=lambda v: [float(x) for x in v.split(",")],
        default=[0.81, 0.87, 0.84, 0.88],
        help="built-in multi,single,packs multi,single (src/rag/embeddingProfile.ts)",
    )

    pb = sub.add_parser("build-pack")
    pb.add_argument("--src", required=True)
    pb.add_argument("--src-sha", required=True)
    pb.add_argument("--e5-vectors", required=True)
    pb.add_argument("--e5-sha", required=True)
    pb.add_argument("--e5-repo", required=True)
    pb.add_argument("--e5-revision", required=True)
    pb.add_argument("--id", required=True)
    pb.add_argument("--name", required=True)
    pb.add_argument("--out", required=True)
    pb.add_argument("--built-at", required=True, help="ISO date stored in meta.builtAt (pinned for reproducible builds)")

    a = p.parse_args()
    {"parity": cmd_parity, "calibrate": cmd_calibrate, "build-pack": cmd_build_pack}[a.cmd](a)


if __name__ == "__main__":
    main()
