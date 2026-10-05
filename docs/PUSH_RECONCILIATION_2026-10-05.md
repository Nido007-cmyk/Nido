# Reconciliación Remote/Branch — NIDO Push Consolidado

**Fecha:** 2026-10-05
**Estado:** DOCUMENTADO, NO EJECUTADO (requiere decisión del owner)

## Estado observado

| Elemento | Valor actual |
|----------|--------------|
| Branch local | `master` |
| HEAD local | `0202495e077267f8b2bf3eefbf1d8ccc0fd669e7` |
| Remote configurado | `https://github.com/arsrs91-png/NIDO.git` (VIEJO) |
| Repo destino | `Nido007-cmyk/Nido` (NUEVO) |
| Branch destino | `main` |
| Método requerido | Bridge API (`gh_bridge.py`), NO `git push` directo |

## Por qué no se puede hacer `git push` directo

1. El remote apunta al repo viejo (`arsrs91-png/NIDO`), no al nuevo.
2. El bridge API es el único método que funciona en este entorno
   (git smart-HTTP/SSH está bloqueado en el sandbox).
3. La autorización especifica branch `main`, pero el local está en `master`.

## Plan de reconciliación (para cuando el owner autorice)

### Opción A: Push via bridge a `main` (recomendado)

```bash
# 1. Verificar HEAD local final
git rev-parse HEAD
# → 0202495e077267f8b2bf3eefbf1d8ccc0fd669e7

# 2. Push via bridge al repo nuevo, branch main
python3 ~/workspace/skills/github/bin/gh_bridge.py push 0202495e077267f8b2bf3eefbf1d8ccc0fd669e7 --ref refs/heads/main

# 3. Verificar que el SHA remoto == SHA local (byte-for-byte)
# El bridge recrea el commit byte-idéntico; el SHA debe coincidir.
```

**Nota:** El bridge pushea un commit específico a una ref específica.
No requiere que el branch local se llame `main`. El historial se preserva.

### Opción B: Renombrar branch local (NO recomendado sin autorización)

```bash
git branch -m master main
```

Esto cambia el nombre del branch local, pero NO afecta el remote.
El push seguiría requiriendo el bridge. **No hacer sin autorización explícita.**

## Verificaciones post-push (obligatorias)

1. ✅ Repo correcto: `Nido007-cmyk/Nido`
2. ✅ Branch: `main`
3. ✅ SHA remoto == SHA local (`0202495e...`)
4. ✅ Historia esperada (sin commits extraños)
5. ✅ Cero archivos/secretos accidentales

## Lo que NO se hará

- ❌ `git push` directo (no funciona en este entorno)
- ❌ Force-push
- ❌ Alterar historia silenciosamente
- ❌ Renombrar branch sin autorización
- ❌ Cambiar el remote a ciegas

## Decisión pendiente del owner

El push consolidado está AUTORIZADO en principio, pero la ejecución
requiere confirmación explícita del owner sobre:
1. ¿Proceder con Opción A (bridge a `main`)?
2. ¿O hay un paso intermedio requerido?

**HEAD a publicar (cuando se autorice):** `0202495e077267f8b2bf3eefbf1d8ccc0fd669e7`
