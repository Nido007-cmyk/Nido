> **Language:** English · [Español](../es/demo/README.md)

# BOAR demo

Posted on X: [the BOAR thread](https://x.com/arferrari/status/2103677576380387484).

Recorded on a Xiaomi phone (MediaTek Dimensity, 12 GB RAM) in airplane mode, with
the default model, Qwen2.5-1.5B-Instruct (about 1 GB). Nothing leaves the phone.

## Videos

<video src="https://github.com/rferrari/boar-app/raw/refs/heads/main/docs/demo/boar_demo_small.mp4" controls width="360">
  <a href="https://github.com/rferrari/boar-app/raw/refs/heads/main/docs/demo/boar_demo_small.mp4">Play the BOAR demo (4:01)</a>
</video>

Tap a preview to play the full clip.

<table>
<tr>
<td width="25%"><a href="1-offline-first-question.mp4"><img src="previews/1.gif" alt="Offline, first question"></a></td>
<td width="25%"><a href="2-prompt-idea.mp4"><img src="previews/2.gif" alt="A research prompt"></a></td>
<td width="25%"><a href="3-follow-up-context.mp4"><img src="previews/3.gif" alt="Follow-up"></a></td>
<td width="25%"><a href="4-facts-and-math.mp4"><img src="previews/4.gif" alt="Facts and math"></a></td>
</tr>
<tr>
<td><b>1. Offline, first question</b> (0:35). Airplane mode on, a question answered with sources from the offline library.</td>
<td><b>2. A research prompt</b> (1:17). A ready-made prompt from Prompt Ideas: a synthesis question across topics.</td>
<td><b>3. Follow-up</b> (1:21). "interesting, continue": the answer picks up from the conversation so far.</td>
<td><b>4. Facts and math</b> (0:38). The capital of Australia from the Wikipedia Vital Articles pack, then 7×8.</td>
</tr>
</table>

The whole walkthrough in one file: [boar_demo_small.mp4](boar_demo_small.mp4) (4:01).

## Screenshots

<table>
<tr>
<td width="33%"><img src="screenshots/01-offline-answer-sources.png" alt="Answer with offline sources"></td>
<td width="33%"><img src="screenshots/03-prompt-ideas.png" alt="Prompt Ideas"></td>
<td width="33%"><img src="screenshots/02-menu.png" alt="Menu"></td>
</tr>
<tr>
<td><b>Answers with sources.</b> Every answer lists the offline articles it used and how well each matched. The OFFLINE badge and the airplane icon are real.</td>
<td><b>Prompt Ideas.</b> Ready-made research questions to try the app with.</td>
<td><b>Menu.</b> Past sessions, your own documents, settings and telemetry. RAM and disk use are always visible at the bottom.</td>
</tr>
<tr>
<td><img src="screenshots/04-models.png" alt="Installed models"></td>
<td><img src="screenshots/05-more-models.png" alt="More models and Hugging Face search"></td>
<td><img src="screenshots/06-telemetry.png" alt="Execution telemetry"></td>
</tr>
<tr>
<td><b>Models.</b> The default model and the embedding model, plus optional ones you can switch to with one tap.</td>
<td><b>Bring your own model.</b> Mixture-of-experts and Gemma models tested on this phone, and a search for any GGUF model on Hugging Face.</td>
<td><b>Execution telemetry.</b> Every answer is measured: tokens per second, time to first token, peak memory. Export as JSON or CSV.</td>
</tr>
<tr>
<td><img src="screenshots/07-memory-storage.png" alt="Memory and storage"></td>
<td><img src="screenshots/08-benchmark-engine.png" alt="Last benchmark and engine"></td>
<td></td>
</tr>
<tr>
<td><b>Memory and storage.</b> The app's RAM use against the 12 GB limit, and its storage against the 50 GB budget.</td>
<td><b>Engine.</b> The last answer's numbers and the model, context size, threads and license in use (llama.cpp through llama.rn).</td>
<td></td>
</tr>
</table>

## Measured on the phone

Six knowledge questions with the default 1.5B model and the Vital Articles pack
(`npm run eval:device`, 2026-09-24): 6 of 6 answered correctly, all from retrieved
articles, about 10.6 s per answer (6.4 s to the first word, 17.5 tokens/s), 1.76 GB
peak memory. See [DEVICE_EVALUATION.md](../DEVICE_EVALUATION.md) to run it yourself.
