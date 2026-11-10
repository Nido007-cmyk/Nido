import json, sys, time, re
import llama_cpp
S = sys.argv[1]; N = int(sys.argv[2]); out_path = sys.argv[3]
cases = json.load(open(S + "/bench/cases.json"))["cases"]
llm = llama_cpp.Llama(model_path=S + "/gguf/qwen3-0.6b-q4km.gguf", n_ctx=2048, n_threads=2, verbose=False)
MIN_SYS = "You are Nido, a personal AI assistant that runs offline on the user's phone. Answer in the user's language."
def chatml(messages, think):
    p = ""
    for m in messages:
        p += f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n"
    return p + "<|im_start|>assistant\n" + ("" if think else "<think>\n\n</think>\n\n")
VARIANTS = {
    "F_sistema_minimo": dict(sys="min", think=False, style=True),
    "G_sin_estilo": dict(sys="base", think=False, style=False),
    "H_razona": dict(sys="base", think=True, style=True),
    "I_minimo_razona": dict(sys="min", think=True, style=True),
}
sel = [c for c in cases if c["tone"] == "succinct" and c["nCtx"] == 1024 and c["noSourcesNote"]]
res = []; t0 = time.time()
for vname, v in VARIANTS.items():
    for c in sel:
        msgs = json.loads(json.dumps(c["messages"]))
        if v["sys"] == "min": msgs[0]["content"] = MIN_SYS
        if not v["style"]: msgs[-1]["content"] = msgs[-1]["content"].split("\n\n(Response style:")[0]
        prompt = chatml(msgs, v["think"])
        ptoks = len(llm.tokenize(prompt.encode("utf-8"), add_bos=False, special=True))
        for seed in range(N):
            llm.reset()
            r = llm.create_completion(prompt, max_tokens=(900 if v["think"] else c["genTokens"]), temperature=0.7, top_p=0.8, top_k=20, min_p=0.0,
                                      repeat_penalty=1.1, stop=["<|im_end|>"], seed=1000 + seed)
            ch = r["choices"][0]; raw = ch["text"]
            answer = re.sub(r"<think>.*?</think>", "", raw, flags=re.S).strip() if "</think>" in raw else ("" if raw.lstrip().startswith("<think>") else raw)
            res.append(dict(variant=vname, q=c["q"], seed=seed, text=answer, raw_len=len(raw), finish=ch["finish_reason"],
                            completion_tokens=r["usage"]["completion_tokens"], prompt_tokens=ptoks, est=c["est"], incomplete_utf8_tokens=0))
    print(vname, round(time.time() - t0), "s", flush=True)
    json.dump(res, open(out_path, "w"), ensure_ascii=False, indent=1)
