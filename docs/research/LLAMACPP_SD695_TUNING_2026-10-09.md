# llama.cpp tuning research for NIDO on Snapdragon 695

Research date: 2026-10-08. IDEAS ONLY — no code copied from any repo.
Target: qwen2.5-0.5b-instruct-q4km (default, low-RAM) and qwen2.5-1.5b-instruct-q4km (preferred).
Device: Samsung Galaxy Tab A9+ — Snapdragon 695 (2x2.2GHz Cortex-A78 + 6x1.7GHz Cortex-A55, ARMv8.2, ~4GB usable RAM, LPDDR4X-4266 ≈ 17.1 GB/s theoretical, Adreno 619).

## 1. Sources

| Source | URL | License status |
|---|---|---|
| jegly/OfflineLLM (repo, releases, README Performance section) | https://github.com/jegly/OfflineLLM | **NOASSERTION** (GitHub) — README badge claims Apache 2.0 but no verified LICENSE; IDEAS ONLY, no code copied |
| llama.cpp upstream docs (server/README, snapdragon backend README) | https://github.com/ggml-org/llama.cpp | MIT (permissive) |
| llama.rn API docs (mybigday + forks) | https://github.com/mybigday/llama.rn | MIT (permissive) |
| ik_llama.cpp parameters docs | https://github.com/ikawrakow/ik_llama.cpp | MIT-style |
| smolbenchmark (llama.cpp Android build notes) | https://github.com/yuvrajsingh-mist/smolbenchmark | repo-licensed, ideas only |
| llama.kt (llama.rn-derived Kotlin binding, Dimensity 900 test) | https://github.com/hokanosekai/llama.kt | repo-licensed, ideas only |
| phineas1500/androidlm (Pixel 8 Pro repack kernel measurements) | https://github.com/phineas1500/androidlm | repo-licensed, ideas only |
| sanjaramin/aide-os FINDINGS.md (Qwen2.5-Coder 0.5B/1.5B Q4_K_M phone measurements) | https://github.com/sanjaramin/aide-os | repo-licensed, ideas only |
| vieenrose/voxsumdroid (prefill/all-cores, gen/big-cores commit, measured) | https://github.com/vieenrose/voxsumdroid | repo-licensed, ideas only |
| siddhesh2377/soundsguyza llama.cpp-android PERFORMANCE.md | (forks) | repo-licensed, ideas only |
| PatentLLM blog (auto-tuning, +54% tok/s on Qwen3.5-27B) | https://media.patentllm.org | blog, ideas only |
| aifoss.dev quantization guide (q8_0 KV + flash attention note) | https://aifoss.dev | blog, ideas only |

## 2. Thread configuration (SD695)

Consensus across all sources is the same split:

- **Token generation (decode, memory-bandwidth-bound, barrier per token): big cores only → `n_threads = 2`.**
  OfflineLLM's README states its app does exactly "prompt processing uses every core, generation sticks to the big cores". llama.kt measured up to **6x faster** with big-core pinning vs llama.cpp's auto-detect on big.LITTLE. ik_llama.cpp docs advise matching physical core count and avoiding odd numbers. voxsumdroid measured widening generation across all cores made it ~2x worse (slow-core thread stalls the per-token barrier).
- **Prompt processing (compute-bound, full matmuls): all cores → `n_threads_batch = 8`.**
  voxsumdroid measured prefill 7.5 → 11.5 tok/s (+53%) on an 8-core phone after routing prefill to every online core (with `sched_setaffinity`, since llama workers otherwise inherit the caller's mask and stay parked on the big cluster by Android's EAS scheduler).
- llama.cpp upstream: `-t/--threads` (generation) and `-tb/--threads-batch` (batch/prompt) are separate knobs; `-tb` defaults to the `-t` value.
- **llama.rn gap to verify:** the llama.rn ContextParams API docs (upstream + forks) expose `n_threads`, `n_batch`, `n_ubatch`, `cpu_mask`, `cpu_strict`, `cache_type_k/v`, `flash_attn_type`, `use_mmap`, `use_mlock` — but `n_threads_batch` does not appear in the indexed docs. Check the llama.rn version NIDO pins. If absent, the split must be achieved another way (e.g. `cpu_mask`/`cpu_strict`, or a small native patch exposing it).

Expected decode on SD695 (inference, needs device measurement): memory-bound throughput ≈ usable_bandwidth / model_size. With ~10 GB/s sustained: **0.5B ≈ 15–25 tok/s; 1.5B ≈ 7–11 tok/s.**

## 3. KV cache & context (memory math)

Verified architecture specs (Qwen/HF model cards):
- **0.5B-Instruct:** 24 layers, 14 Q heads, **2 KV heads** (GQA), head_dim 64 → per-token f16 KV = 24 × 2 × 64 × 2 × 2 B = **24 KiB/token**
- **1.5B-Instruct:** 28 layers, 12 Q heads, **2 KV heads**, head_dim 128 → **28 KiB/token**

Model file sizes (Q4_K_M, published GGUF sizes): 0.5B ≈ **397 MB**; 1.5B ≈ **986 MB**.

| Config | Weights | KV cache f16 | q8_0 KV | Est. total (KV f16 + compute buf) |
|---|---|---|---|---|
| 0.5B, n_ctx 2048 | 397 MB | ~48 MB | ~25 MB | ~600 MB |
| 0.5B, n_ctx 4096 | 397 MB | ~96 MB | ~50 MB | ~650 MB |
| 1.5B, n_ctx 4096 | 986 MB | ~112 MB | ~58 MB | ~1.25–1.35 GB |
| 1.5B, n_ctx 8192 | 986 MB | ~224 MB | ~116 MB | ~1.35–1.5 GB |

Recommendations:
- **0.5B: `n_ctx = 4096`** (f16 KV). Comfortably fits; 8192 possible with q8_0 KV.
- **1.5B: `n_ctx = 4096`** default; 8192 only with q8_0 KV and it lands at the top of the ~1.5 GB budget — device test required before shipping.
- **q8_0 KV cache** roughly halves KV memory with "little measurable quality cost" (multiple sources agree); OfflineLLM ships it as an experimental toggle. Note: in recent llama.cpp, **quantized V cache requires flash attention** (`flash_attn_type: "on"` or "auto"; llama.rn exposes this). If context creation fails, fall back to quantizing K only.
- **Watch the logits buffer:** OfflineLLM found llama.cpp reserves a logits buffer sized for the whole batch — on a 248k-vocab model it was 497 MiB, capped to 12 MiB by limiting `n_outputs_max` to the single sampled token. Qwen2.5's vocab is 152,064, so at n_batch=512 the default buffer could be ~300 MB. Verify what llama.cpp/llama.rn defaults to and cap it — this is a silent RAM killer on 4 GB devices.
- **Context shifting** (`ctx_shift` in llama.rn): when KV fills, keep system prompt + recent tokens and drop the middle — allows indefinite conversation without reload. Several forks implement this; recommend enabling.
- **Incremental prompting:** OfflineLLM 5.1.0 stopped re-decoding the whole conversation each turn (only new tokens enter the KV cache). Verify NIDO already does this (KV prefix reuse); it removes quadratic multi-turn slowdown.

## 4. Quantization guidance

- **Stay with Q4_K_M for weights.** Unanimous across sources (OfflineLLM "best quality/speed balance"; ik_llama docs; llama.kt). Q4_0 is marginally faster with slightly worse quality — a possible A/B later, not the default.
- **imatrix / per-layer:** only relevant for i-quants (IQ2/IQ3/etc.). Not needed for Q4_K_M.
- **Qwen2.5 quirk worth knowing:** its 152k vocab makes the output head relatively large (~9% of a 0.5B model); Q4_K_M keeps it reasonable. No special handling needed beyond the logits-buffer cap above.

## 5. Other tuning

- **n_batch / n_ubatch: 512 / 512.** llama.cpp defaults are 2048/512; phone-oriented projects (llama-cpp-python, phone tuning guides) converge on 512/512. Larger n_ubatch raises the compute buffer but at n_ctx 4096 the delta is tiny (tens of MB); it mainly trades prefill chunking granularity. Verify on device; 256/512 also defensible if prefill RAM spikes appear.
- **mmap: test OFF.** OfflineLLM measured mmap-off as "measurably quicker to first token on phones" and made it the default. Counterpoint: mmap-off reads the whole model into RAM at load (986 MB for the 1.5B) — peak-load memory must be measured on the Tab A9+. llama.cpp collapsed mmap/mlock into a single `load_mode` enum in recent builds; llama.rn still exposes `use_mmap?`/`use_mlock?`.
- **Warmup: keep it.** Upstream llama.cpp warms up with an empty run by default (`--no-warmup` to disable); OfflineLLM additionally runs a 1-token warmup decode after load. First-token latency matters to users; keep warmup on and measure TTFT.
- **Weight repacking: keep ON.** OfflineLLM 5.0.2 re-enabled `GGML_LLAMAFILE` repacked SIMD GEMM kernels (they'd been off in 5.0.1 — "speedup varies by device"). androidlm measured +23% prefill from repacked dense weights into the CPU_REPACK buffer. llama.rn exposes `no_extra_bufts?` — leave it false (default).
- **Do NOT register extra backends on CPU-only loads.** OfflineLLM 5.1.1 root-caused a 5x CPU regression (<2 tok/s vs ~10 on Pixel 6a): merely *registering* the Vulkan backend let its pinned host buffer outrank the CPU's weight-repacking buffer, so weights never got repacked into dotprod/i8mm layouts — inference silently fell back to generic paths. Fix: restrict the device list to CPU when GPU offload is off. For NIDO (CPU-only today): ensure only the CPU backend is registered.
- **Sustained performance mode:** jegly's Box app added `setSustainedPerformanceMode(true)` to lock clocks during inference and avoid mid-conversation thermal throttling. Cheap to try on the Tab A9+; measure thermal behavior during long generations.

## 6. Chip-specific findings (SD695 / Kryo 660)

- **No i8mm, no SVE.** Kryo 660 is ARMv8.2; int8 matrix-multiply (i8mm) needs ARMv8.6+, SVE needs ARMv9. smolbenchmark explicitly: "Do NOT add +i8mm — not present on this SoC" (their SoC is also A78-based ARMv8.2).
- **dotprod: LIKELY on the big cores, NOT confirmed by any source found — must verify on device.** ASIMDDP is optional in ARMv8.2 (mandatory only from ARMv8.4); cpu-monkey's SD695 page lists only "NEON" (unreliable crowd data). ggml detects features at runtime via HWCAP — OfflineLLM's diagnostics UI shows exactly this: `DOTPROD` + `MATMUL_INT8` flags = fast quantized-matmul kernels; NEON-only = armv8.0 baseline, "several times slower". **Read the llama.cpp startup `system_info` line on the Tab A9+ (`DOTPROD = 1`?) — this is the single highest-value 30-second check.** If the NDK build was made without `GGML_CPU_ARM_ARCH="armv8.2-a+dotprod+fp16"`, kernels can be ~10x slower (smolbenchmark: cmake auto-detection fails silently; openweights: missing dotprod/i8mm kernels reads as ~10x slowdown).
- **fp16:** A78/A55 implement optional full-FP16; smolbenchmark confirmed `+fp16` (asimdhp paths) on their A78 SoC. Include in the arch flag.
- **GPU (Adreno 619):** OfflineLLM's finding — Vulkan offload wins most on Adreno-class GPUs, but on midrange parts token generation stays memory-bandwidth-bound and CPU kernels can be faster. For now CPU-only is the right call; Vulkan is a future experiment, not this lane.
- **Build guidance for whoever compiles the native lib:** `GGML_CPU_ARM_ARCH="armv8.2-a+dotprod+fp16"`, `GGML_OPENMP=OFF` (NDK OpenMP is broken — use pthreads), `-O3`, `GGML_CPU_ALL_VARIANTS` + `GGML_BACKEND_DL` for runtime kernel dispatch (OfflineLLM's approach: 7 variants armv8.0→armv9.2, ggml scores them against CPU features at load). Note: llama.rn ships prebuilt binaries — check which arch flags the pinned llama.rn was built with; if NIDO ever builds its own, use the above.

## 7. Concrete next steps for NIDO (ordered by value/effort)

1. **[DEVICE] Read the llama.cpp `system_info` startup line on the Tab A9+.** Confirms DOTPROD/fp16 detection. 30 seconds, highest value. If DOTPROD=0, everything else is secondary — investigate the llama.rn build flags.
2. **[DEVICE] A/B thread configs with a fixed prompt:** (a) n_threads=2 gen / 8 prefill split vs (b) current defaults. Expect generation unchanged-or-better on 2 big cores; prefill up to ~50% faster. Needs `n_threads_batch` exposure — check llama.rn first (see #7).
3. **Cap `n_outputs_max` / logits buffer.** Verify llama.rn/llama.cpp default; Qwen2.5's 152k vocab can silently reserve hundreds of MB. (OfflineLLM precedent: 497→12 MiB.)
4. **Set n_ctx 4096 + n_batch/n_ubatch 512/512 + ctx_shift on** as the new baseline for both models; measure load RAM, TTFT, tok/s (prefill and decode separately).
5. **Try q8_0 KV cache (`cache_type_k/v`) with `flash_attn_type: "on"`** as an experimental toggle (OfflineLLM ships exactly this); verify quality on NIDO's eval prompts, not just speed.
6. **A/B `use_mmap` on vs off** on the Tab A9+: measure time-to-first-token AND peak load RAM (mmap-off helps TTFT but loads 397 MB / 986 MB into RAM).
7. **Check pinned llama.rn version for `n_threads_batch` support.** If missing, evaluate: (a) cpu_mask-based workaround, (b) upgrading llama.rn, (c) minimal native patch. Do not fork llama.cpp for this alone.
8. **[DEVICE] Long-generation thermal test** (5+ min) with and without `setSustainedPerformanceMode(true)`; record tok/s decay curve.
9. **Verify incremental prompting / KV prefix reuse across turns** (no full re-decode) — if absent, it's a multi-turn latency win comparable to the thread split.
10. **Future (separate lane):** Vulkan offload experiment on Adreno 619; Q4_0 A/B vs Q4_K_M; speculative/MTP decoding (Qwen2.5-instruct has no MTP head — skip).

Everything marked [DEVICE] needs the physical Tab A9+. Items 3, 4(partial), 7 can be done statically (read llama.rn version + params) without the device.
