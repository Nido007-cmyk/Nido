import json, sys, time, re
import llama_cpp
S = sys.argv[1]; N = int(sys.argv[2]); out_path = sys.argv[3]
cases = json.load(open(S + "/bench/cases.json"))["cases"]
OLD = (" No relevant sources were found in the offline index for this question. Do NOT invent facts. If this is a factual question you cannot answer "
       "reliably without sources, say honestly that you don't know the answer and suggest what the user could check. Only answer from general knowledge "
       "for non-factual requests (opinions, creative writing, simple calculations).")
NEW = sys.argv[4] if len(sys.argv) > 4 else ""
llm = llama_cpp.Llama(model_path=S + "/gguf/qwen3-0.6b-q4km.gguf", n_ctx=2048, n_threads=2, verbose=False)

def chatml(messages):
    p = ""
    for m in messages:
        p += f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n"
    return p + "<|im_start|>assistant\n<think>\n\n</think>\n\n"

VARIANTS = {
    "A_base_t0.7": dict(note="old", temp=0.7),
    "B_base_t0.5": dict(note="old", temp=0.5),
    "C_nueva_t0.7": dict(note="new", temp=0.7),
    "D_nueva_t0.5": dict(note="new", temp=0.5),
    "E_sin_t0.7": dict(note="none", temp=0.7),
}
sel = [c for c in cases if c["tone"] == "succinct" and c["nCtx"] == 1024 and c["noSourcesNote"]]
res = []
t0 = time.time()
for vname, v in VARIANTS.items():
    for c in sel:
        msgs = json.loads(json.dumps(c["messages"]))
        assert OLD in msgs[0]["content"], "nota vieja no encontrada"
        if v["note"] == "new":
            msgs[0]["content"] = msgs[0]["content"].replace(OLD, NEW)
        elif v["note"] == "none":
            msgs[0]["content"] = msgs[0]["content"].replace(OLD, "")
        prompt = chatml(msgs)
        ptoks = len(llm.tokenize(prompt.encode("utf-8"), add_bos=False, special=True))
        for seed in range(N):
            llm.reset()
            r = llm.create_completion(prompt, max_tokens=c["genTokens"], temperature=v["temp"], top_p=0.8, top_k=20, min_p=0.0,
                                      repeat_penalty=1.1, stop=["<|im_end|>"], seed=1000 + seed)
            ch = r["choices"][0]
            toks = llm.tokenize(ch["text"].encode("utf-8"), add_bos=False, special=False)
            incomplete = 0
            for t in toks:
                b = llm.detokenize([t])
                try: b.decode("utf-8")
                except UnicodeDecodeError: incomplete += 1
            res.append(dict(variant=vname, q=c["q"], seed=seed, text=ch["text"], finish=ch["finish_reason"],
                            completion_tokens=r["usage"]["completion_tokens"], prompt_tokens=ptoks, est=c["est"],
                            incomplete_utf8_tokens=incomplete))
    print(vname, round(time.time() - t0), "s", flush=True)
json.dump(res, open(out_path, "w"), ensure_ascii=False, indent=1)
