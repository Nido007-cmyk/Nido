import json, re, sys, collections
res = json.load(open(sys.argv[1]))
ABST = re.compile(r"no (lo )?s[eé]\b|no tengo (informaci|acceso|datos|la informaci)|no puedo (ayudar|responder|proporcionar|dar)|no dispongo|lo siento|i don't know|i do not know|no hay (informaci|fuentes)|no encontr", re.I)
def m(text, pat): return re.search(pat, text, re.I) is not None
def metrics(r):
    t = r["text"]; q = r["q"]; d = {}
    d["abstiene"] = bool(ABST.search(t))
    d["tope"] = r["finish"] == "length"
    d["tokens"] = r["completion_tokens"]
    d["cierra_frase"] = t.strip()[-1:] in ".!?…»\")"
    if "llanta" in q:
        kw = [r"\bgato\b|\bjack\b|crick", r"tuerca|birlo|perno|tornillo", r"repuesto|refacci|auxilio|de reserva|nueva llanta|llanta nueva|neum[aá]tico nuevo", r"afloj|desenrosc|quit(a|ar) (las|los)", r"apr[ie]+t|ajust"]
        d["cobertura_llanta_0a5"] = sum(1 for k in kw if m(t, k))
        d["motor_en_marcha"] = m(t, r"motor (est[eé]|esté|en) (en )?(marcha|encendido|funcionando)|enciend[ea] el motor|arranca el motor")
    if "5 pasos" in q:
        d["cinco_pasos"] = all(re.search(rf"(^|\n)\s*{i}[\.\)]", t) for i in range(1, 6)) and not re.search(r"(^|\n)\s*6[\.\)]", t)
    if "huevos" in q: d["correcto_29"] = m(t, r"\b29\b")
    if "tren" in q: d["correcto_12_10"] = m(t, r"12[:\.h ]\s?10")
    if "zorro" in q: d["cuento_zorro_nada"] = m(t, r"zorro") and m(t, r"nad")
    if "correo" in q:
        d["menciona_musica"] = m(t, r"m[uú]sica")
        d["frases"] = len([s for s in re.split(r"(?<=[\.!?])\s+", t.strip()) if s])
    return d
agg = collections.defaultdict(lambda: collections.defaultdict(list))
for r in res:
    for k, v in metrics(r).items():
        agg[r["variant"]][k].append(v)
        agg[r["variant"]][(r["q"][:28], k)].append(v)
keys = ["abstiene", "tope", "tokens", "cierra_frase", "cobertura_llanta_0a5", "motor_en_marcha", "cinco_pasos", "correcto_29", "correcto_12_10", "cuento_zorro_nada", "menciona_musica", "frases"]
vs = sorted(agg)
print("%-22s" % "métrica", *["%14s" % v for v in vs])
for k in keys:
    row = []
    for v in vs:
        x = agg[v][k]
        row.append("%14s" % (f"{sum(x)}/{len(x)}" if isinstance(x[0], bool) else f"{sum(x)/len(x):.2f}"))
    print("%-22s" % k, *row)
print("\nabstención por pregunta:")
for q in sorted({r["q"][:28] for r in res}):
    print("%-30s" % q, *["%14s" % f"{sum(agg[v][(q,'abstiene')])}/{len(agg[v][(q,'abstiene')])}" for v in vs])
pt = {(r["q"][:28]): (r["prompt_tokens"], r["est"]) for r in res if r["variant"].startswith("A_")}
print("\nBPE real del prompt vs estimador de la app:", pt)
print("tokens con UTF-8 a medias por respuesta (suma):", sum(r["incomplete_utf8_tokens"] for r in res), "en", len(res), "respuestas;", sum(1 for r in res if r["incomplete_utf8_tokens"]>0), "respuestas con alguno")
print("respuestas con salto de línea:", sum(1 for r in res if "\n" in r["text"].strip()))
