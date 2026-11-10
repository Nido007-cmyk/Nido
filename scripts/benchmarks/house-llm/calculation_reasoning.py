import json, sys, time, re
import llama_cpp
S = sys.argv[1]; N = int(sys.argv[2]); out_path = sys.argv[3]
cases = json.load(open(S + "/bench/cases.json"))["cases"]
base = next(c for c in cases if c["tone"] == "succinct" and c["nCtx"] == 1024 and c["noSourcesNote"])
SYS = base["messages"][0]["content"]; STYLE = "\n\n(Response style:" + base["messages"][-1]["content"].split("\n\n(Response style:")[1]
llm = llama_cpp.Llama(model_path=S + "/gguf/qwen3-0.6b-q4km.gguf", n_ctx=2048, n_threads=2, verbose=False)
BANK = [
 ("Tengo 3 cajas de 12 huevos y se rompen 7. ¿Cuántos huevos me quedan?", r"\b29\b", "es"),
 ("Un tren sale a las 9:00 y el viaje dura 2 horas y media. Si lleva 40 minutos de retraso, ¿a qué hora llega?", r"12[:\.h ]\s?10", "es"),
 ("Si compro 4 panes a 15 pesos cada uno y pago con un billete de 100, ¿cuánto me devuelven?", r"\b40\b", "es"),
 ("¿Cuánto es el 15% de 200?", r"\b30\b", "es"),
 ("Tengo 250 pesos y gasto 75 en comida y 60 en transporte. ¿Cuánto me queda?", r"\b115\b", "es"),
 ("Una receta para 4 personas lleva 300 gramos de arroz. ¿Cuánto arroz necesito para 10 personas?", r"\b750\b", "es"),
 ("¿Cuántos minutos hay en 3 horas y cuarto?", r"\b195\b", "es"),
 ("I have 5 boxes with 8 apples each and I give away 9. How many apples are left?", r"\b31\b", "en"),
 ("If a movie starts at 7:45 pm and lasts 1 hour 50 minutes, what time does it end?", r"9[:\.]35", "en"),
 ("Tenho 6 pacotes com 10 biscoitos cada e como 14. Quantos biscoitos sobram?", r"\b46\b", "pt"),
]
EN=re.compile(r"\b(the|and|with|your|you|of|is|are|left)\b",re.I); ES=re.compile(r"\b(el|la|los|las|que|para|con|una|quedan|llega|son|me|te)\b",re.I); PT=re.compile(r"\b(você|sobram|são|com|os|as|um|uma|biscoitos)\b",re.I)
def lang(t):
    s={"en":len(EN.findall(t)),"es":len(ES.findall(t)),"pt":len(PT.findall(t))}
    return max(s,key=s.get) if max(s.values())>0 else "?"
def chatml(q, think):
    return f"<|im_start|>system\n{SYS}<|im_end|>\n<|im_start|>user\n{q}{STYLE}<|im_end|>\n<|im_start|>assistant\n" + ("" if think else "<think>\n\n</think>\n\n")
res=[]; t0=time.time(); BUDGET=int(sys.argv[4])
for think in (False, True):
    for q, pat, lg in BANK:
        prompt = chatml(q, think)
        for seed in range(N):
            llm.reset()
            r = llm.create_completion(prompt, max_tokens=BUDGET, temperature=0.7, top_p=0.8, top_k=20, min_p=0.0, repeat_penalty=1.1, stop=["<|im_end|>"], seed=2000+seed)
            raw = r["choices"][0]["text"]
            unfinished = think and "</think>" not in raw
            ans = "" if unfinished else (raw.split("</think>",1)[1].strip() if "</think>" in raw else raw.strip())
            res.append(dict(think=think, q=q, lg=lg, seed=seed, raw=raw, answer=ans, unfinished=unfinished, correct=bool(re.search(pat, ans)),
                            lang_ok=(lang(ans)==lg) if ans else False, tokens=r["usage"]["completion_tokens"], finish=r["choices"][0]["finish_reason"]))
    print("think" if think else "nothink", round(time.time()-t0), "s", flush=True)
    json.dump(res, open(out_path,"w"), ensure_ascii=False, indent=1)
