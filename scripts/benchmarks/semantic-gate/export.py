import json, sys, base64, numpy as np, llama_cpp
sys.path.insert(0, sys.argv[1] + "/sem")
from exam_and_anchors import H4, E4, G4
S = sys.argv[1]
CFG = [("e5", "e5.gguf", "query: ", "0.0001.fp1", "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde"),
       ("bge", "bge.gguf", "", "0.001.fp1", "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514")]
PROBE = "¿Qué hago si mi hijo tiene fiebre alta y no despierta?"
b64 = lambda a: base64.b64encode(np.asarray(a, dtype="<f4").tobytes()).decode()
out = {}; fixtures = {}
for tag, model, pre, cfg, sha in CFG:
    z = np.load(S + f"/sem/{tag}.{cfg}.npz")
    w = z["w"].astype(np.float32); c = np.float32(z["b"] - z["mu"] @ z["w"])
    llm = llama_cpp.Llama(model_path=S + "/gguf/" + model, embedding=True, n_ctx=512, n_threads=2, verbose=False)
    def emb(t):
        v = np.array(llm.embed(pre + t), dtype=np.float64)
        if v.ndim > 1: v = v.mean(axis=0)
        return (v / np.linalg.norm(v)).astype(np.float32)
    raw = np.array(llm.embed(pre + PROBE), dtype=np.float64); 
    print(tag, "norma del vector crudo:", round(float(np.linalg.norm(raw)), 4), "dim", raw.shape)
    probe = emb(PROBE)
    out[sha] = dict(tag=tag, dim=int(w.shape[0]), w=b64(w), c=float(c), probe=b64(probe), probeScore=float(probe @ w + c))
    fx = []
    for text, label in [(t, True) for t in H4 + E4] + [(t, False) for t in G4]:
        v = emb(text); s = float(v @ w + c)
        fx.append(dict(text=text, danger=label, score=round(s, 4), vec=b64(v)))
    fixtures[sha] = fx
    print(tag, "examen:", sum(1 for f in fx if f["danger"] and f["score"] >= 0), "/", len(H4 + E4), "FP", sum(1 for f in fx if not f["danger"] and f["score"] >= 0), "/", len(G4),
          "margen mínimo |score|:", round(min(abs(f["score"]) for f in fx), 4))
json.dump(dict(probeText=PROBE, models=out), open(S + "/sem/weights.json", "w"), ensure_ascii=False)
json.dump(fixtures, open(S + "/sem/fixtures.json", "w"), ensure_ascii=False)
