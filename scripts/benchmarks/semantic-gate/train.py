import json, sys, base64, numpy as np, llama_cpp
sys.path.insert(0, sys.argv[1] + "/sem")
from exam_and_anchors import H4, E4, G4
from training_extra import H5, E5, G5
S = sys.argv[1]; model = sys.argv[2]; qpre = sys.argv[3]; tag = sys.argv[4]
b = json.load(open(S + "/sem/batt.json"))
pos = b["HEALTH"] + b["EMERGENCIES"] + H5 + E5
neg = b["GENERAL"] + b["HOMONYMS"] + G5
test_pos = H4 + E4; test_neg = G4
llm = llama_cpp.Llama(model_path=S + "/gguf/" + model, embedding=True, n_ctx=512, n_threads=2, verbose=False)
def emb(texts):
    out = []
    for t in texts:
        v = np.array(llm.embed(qpre + t), dtype=np.float64)
        if v.ndim > 1: v = v.mean(axis=0)
        out.append(v / (np.linalg.norm(v) + 1e-9))
    return np.stack(out)
Xp, Xn, Tp, Tn = emb(pos), emb(neg), emb(test_pos), emb(test_neg)
mu = np.vstack([Xp, Xn]).mean(axis=0)
def fit(X, y, l2, it=4000, lr=10.0):
    w = np.zeros(X.shape[1]); b0 = 0.0
    for _ in range(it):
        p = 1 / (1 + np.exp(-(X @ w + b0)))
        w -= lr * (X.T @ (p - y) / len(y) + l2 * w); b0 -= 0.5 * (p - y).mean()
    return w, b0
X = np.vstack([Xp, Xn]) - mu; y = np.r_[np.ones(len(Xp)), np.zeros(len(Xn))]
rep = {}
for l2 in (1e-4, 1e-3):
    rng = np.random.default_rng(0); idx = rng.permutation(len(y)); folds = np.array_split(idx, 8); sc = np.zeros(len(y))
    for f in folds:
        tr = np.setdiff1d(idx, f); w, b0 = fit(X[tr], y[tr], l2); sc[f] = X[f] @ w + b0
    negs = np.sort(sc[y == 0])
    for name, q in (("fp1", 0.99), ("fp0", 1.0)):
        th = negs[min(len(negs) - 1, int(np.ceil(q * len(negs))) - 1)] + 1e-4
        w, b0 = fit(X, y, l2)
        tp = (Tp - mu) @ w + b0; tn = (Tn - mu) @ w + b0
        rep[f"{l2}/{name}"] = dict(th=float(th), cv_recall=round(float((sc[y == 1] >= th).mean()), 3), cv_fp=round(float((sc[y == 0] >= th).mean()), 3),
            test_health=int((tp[:len(H4)] >= th).sum()), test_emerg=int((tp[len(H4):] >= th).sum()), test_fp=int((tn >= th).sum()),
            n=[len(pos), len(neg), len(H4), len(E4), len(G4)], missed=[t for t, s in zip(test_pos, tp) if s < th], fps=[t for t, s in zip(test_neg, tn) if s >= th])
        np.savez(S + f"/sem/{tag}.{l2}.{name}.npz", mu=mu, w=w, b=b0 - th, Tp=Tp, Tn=Tn)
json.dump(rep, open(S + f"/sem/{tag}.train.json", "w"), ensure_ascii=False, indent=1)
print(tag, json.dumps({k: {x: v[x] for x in ("cv_recall", "cv_fp", "test_health", "test_emerg", "test_fp", "n")} for k, v in rep.items()}))
