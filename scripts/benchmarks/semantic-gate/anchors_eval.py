import json, sys, numpy as np, llama_cpp
sys.path.insert(0, sys.argv[1] + "/sem")
from exam_and_anchors import H4, E4, G4, ANCHORS
S = sys.argv[1]; model = sys.argv[2]; qpre = sys.argv[3] if len(sys.argv) > 3 else ""
b = json.load(open(S + "/sem/batt.json"))
H, E, G = b["HEALTH"], b["EMERGENCIES"], b["GENERAL"] + b["HOMONYMS"]
cal_pos = H[:87] + E[:31]; cal_neg = b["GENERAL"][:78] + b["HOMONYMS"]
test_pos = H[87:] + E[31:] + H4 + E4; test_neg = b["GENERAL"][78:] + G4
llm = llama_cpp.Llama(model_path=S + "/gguf/" + model, embedding=True, n_ctx=512, n_threads=2, verbose=False)
def emb(texts, pre):
    out = []
    for t in texts:
        v = np.array(llm.embed(pre + t), dtype=np.float32)
        if v.ndim > 1: v = v.mean(axis=0)
        out.append(v / (np.linalg.norm(v) + 1e-9))
    return np.stack(out)
A = emb(ANCHORS, qpre)
def score(texts):
    Q = emb(texts, qpre); sims = Q @ A.T
    return sims.max(axis=1), np.sort(sims, axis=1)[:, -3:].mean(axis=1)
res = {}
for name in ("max", "top3"):
    i = 0 if name == "max" else 1
    cp, cn, tp, tn = score(cal_pos)[i], score(cal_neg)[i], score(test_pos)[i], score(test_neg)[i]
    best = None
    for th in np.arange(0.3, 0.99, 0.005):
        fp = (cn >= th).mean(); rec = (cp >= th).mean()
        if fp <= 0.02 and (best is None or rec > best[1]): best = (th, rec, fp)
    th = best[0]
    res[name] = dict(th=round(float(th), 3), cal_recall=round(float(best[1]), 3), cal_fp=round(float(best[2]), 3),
                     test_recall=round(float((tp >= th).mean()), 3), test_fp=round(float((tn >= th).mean()), 3),
                     n=[len(cal_pos), len(cal_neg), len(test_pos), len(test_neg)],
                     test_missed=[t for t, s in zip(test_pos, tp) if s < th][:40], test_fps=[t for t, s in zip(test_neg, tn) if s >= th])
    np.save(S + f"/sem/{model}.{name}.npy", np.array([cp.mean(), cn.mean()]))
json.dump(res, open(S + f"/sem/{model}.res.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: {x: v[x] for x in ("th", "cal_recall", "cal_fp", "test_recall", "test_fp", "n")} for k, v in res.items()}))
