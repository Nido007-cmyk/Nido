# UI · Evaluation, stats and voice

### `personalitySettings.title`
- **EN:** Assistant tone & response style
- **SW (machine draft, please correct it):** Toni ya msaidizi na mtindo wa majibu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalitySettings.customPromptPlaceholder`
- **EN:** Write your own system prompt…
- **SW (machine draft, please correct it):** Andika maelekezo yako ya mfumo…
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalitySettings.maxOutputTokens`
- **EN:** Max output tokens
- **SW (machine draft, please correct it):** Kiwango cha juu cha tokeni za matokeo
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalitySettings.maxOutputTokensNote`
- **EN:** Caps how long a single response can be — lower is faster and more battery-friendly on phone hardware.
- **SW (machine draft, please correct it):** Inaweka kikomo cha urefu wa jibu moja — kiwango cha chini ni cha haraka zaidi na kinatumia betri kidogo kwenye simu.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalitySettings.deepResearchTitle`
- **EN:** Deep Research Mode
- **SW (machine draft, please correct it):** Hali ya Utafiti wa Kina
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalitySettings.deepResearchNote`
- **EN:** Breaks your question into sub-questions, researches each separately, then synthesizes one answer. Several sequential model calls on the same model — noticeably slower than a normal reply, not multiple AI models running at once. Independent from the response style above: it changes how much research goes into an answer, not its tone — the two combine (e.g. Deep Research + Succinct still synthesizes a short final answer).
- **SW (machine draft, please correct it):** Inavunja swali lako kuwa maswali madogo, inatafiti kila moja kivyake, kisha inachanganya kuwa jibu moja. Ni simu kadhaa za modeli zinazofuatana kwenye modeli ile ile — polepole zaidi kuliko jibu la kawaida, si modeli nyingi za AI zinazoendeshwa kwa wakati mmoja. Haina uhusiano na mtindo wa majibu ulio hapo juu: inabadilisha kiasi cha utafiti kinachoingia kwenye jibu, si toni yake — viwili vinachanganyika (k.m. Utafiti wa Kina + Fupi na ya Moja kwa Moja bado hutoa jibu fupi la mwisho).
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalitySettings.adaptiveRoutingTitle`
- **EN:** Adaptive Routing
- **SW (machine draft, please correct it):** Uelekezaji Unaobadilika
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalitySettings.adaptiveRoutingNote`
- **EN:** Classifies each message and picks which downloaded model answers it (e.g. a lightweight model for small talk, a stronger one for research/comparison questions), switching between them as needed. On by default and independent from Deep Research — if it fails for any reason, chat falls back to your normal active model automatically, it never leaves you without a response.
- **SW (machine draft, please correct it):** Inaainisha kila ujumbe na kuchagua modeli iliyopakuliwa itakayojibu (k.m. modeli nyepesi kwa mazungumzo madogo, yenye nguvu zaidi kwa maswali ya utafiti/kulinganisha), ikibadilika kati yao inapohitajika. Imewashwa kwa chaguo-msingi na haina uhusiano na Utafiti wa Kina — ikishindwa kwa sababu yoyote, gumzo linarudi kwenye modeli yako ya kawaida inayotumika kiotomatiki, halikuachi kamwe bila jibu.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.title`
- **EN:** Voice Input
- **SW (machine draft, please correct it):** Ingizo la Sauti
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.enabledLabel`
- **EN:** Voice input
- **SW (machine draft, please correct it):** Ingizo la sauti
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.enabledValue`
- **EN:** Show the microphone button in the chat to dictate messages.
- **SW (machine draft, please correct it):** Onyesha kitufe cha maikrofoni kwenye gumzo ili udikte ujumbe.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.speechEngineLabel`
- **EN:** Speech-to-text engine
- **SW (machine draft, please correct it):** Injini ya sauti-kuwa-maandishi
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.checking`
- **EN:** Checking…
- **SW (machine draft, please correct it):** Inaangalia…
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.unavailable`
- **EN:** Unavailable on this device
- **SW (machine draft, please correct it):** Haipatikani kwenye kifaa hiki
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.unavailableNote`
- **EN:** No system speech-recognition service was found — common on GrapheneOS / de-Googled builds. An embedded whisper.cpp model would remove this dependency but is a separate project on the scale of the llama.rn integration itself; not implemented in this version.
- **SW (machine draft, please correct it):** Hakuna huduma ya mfumo ya utambuzi wa sauti iliyopatikana — jambo la kawaida kwenye GrapheneOS / matoleo yasiyo na Google. Modeli ya whisper.cpp iliyopachikwa ingeondoa utegemezi huu lakini ni mradi tofauti kwa ukubwa wa ujumuishaji wa llama.rn wenyewe; haijatekelezwa katika toleo hili.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.readAloudLabel`
- **EN:** Read aloud
- **SW (machine draft, please correct it):** Soma kwa sauti
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.readAloudValue`
- **EN:** Reads the assistant's responses using the system voice (no internet).
- **SW (machine draft, please correct it):** Inasoma majibu ya msaidizi kwa kutumia sauti ya mfumo (bila intaneti).
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.engineOnDevice`
- **EN:** On-device recognizer: the audio stays on this phone
- **SW (machine draft, please correct it):** Kitambuzi cha kwenye kifaa: sauti inabaki kwenye simu hii
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.engineSystem`
- **EN:** Only the system voice service (Google’s or the manufacturer’s): it may send the audio over the internet
- **SW (machine draft, please correct it):** Huduma ya sauti ya mfumo tu (ya Google au ya mtengenezaji): inaweza kutuma sauti kupitia intaneti
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.onDeviceOnlyLabel`
- **EN:** On-device recognition only
- **SW (machine draft, please correct it):** Utambuzi wa kwenye kifaa tu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.onDeviceOnlyValue`
- **EN:** When on, dictation only works if your phone can recognize speech without the internet (Android 12 or later with an on-device recognizer). If you turn it off, NIDO can use the system voice service, which may send your audio over the internet.
- **SW (machine draft, please correct it):** Ikiwa imewashwa, udiktaji unafanya kazi tu ikiwa simu yako inaweza kutambua sauti bila intaneti (Android 12 au mpya zaidi yenye kitambuzi cha kwenye kifaa). Ukiizima, NIDO inaweza kutumia huduma ya sauti ya mfumo, ambayo inaweza kutuma sauti yako kupitia intaneti.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `voiceSettings.onlineOnlyNote`
- **EN:** This phone has no on-device speech recognizer, so dictation is off. If you accept that the system service may send your audio over the internet, turn off “On-device recognition only”.
- **SW (machine draft, please correct it):** Simu hii haina kitambuzi cha sauti cha kwenye kifaa, kwa hiyo udiktaji umezimwa. Ukikubali kwamba huduma ya mfumo inaweza kutuma sauti yako kupitia intaneti, zima “Utambuzi wa kwenye kifaa tu”.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalities.succinct.label`
- **EN:** Succinct & Direct
- **SW (machine draft, please correct it):** Fupi na ya Moja kwa Moja
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalities.succinct.description`
- **EN:** Fastest — 2–3 brief paragraphs or bullets, no preamble. Default for mobile.
- **SW (machine draft, please correct it):** Haraka zaidi — aya 2–3 fupi au pointi, bila utangulizi. Chaguo-msingi kwa simu.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalities.detailed.label`
- **EN:** Thorough & Detailed
- **SW (machine draft, please correct it):** Kamili na Yenye Maelezo
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalities.detailed.description`
- **EN:** Structured, thorough explanations with comparisons and reasoning.
- **SW (machine draft, please correct it):** Maelezo yaliyopangwa na kamili yenye ulinganisho na hoja.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalities.summary.label`
- **EN:** Executive Summary
- **SW (machine draft, please correct it):** Muhtasari Mkuu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalities.summary.description`
- **EN:** One top-line takeaway, then 3 key bullet points.
- **SW (machine draft, please correct it):** Hitimisho moja kuu, kisha pointi 3 muhimu.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalities.custom.label`
- **EN:** Custom
- **SW (machine draft, please correct it):** Maalum
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `personalities.custom.description`
- **EN:** Write your own system prompt.
- **SW (machine draft, please correct it):** Andika maelekezo yako ya mfumo.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.title`
- **EN:** Evaluation
- **SW (machine draft, please correct it):** Tathmini
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.subtitle_one`
- **EN:** Set v{{version}} · {{count}} query
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Seti v{{version}} · swali {{count}}
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.subtitle_other`
- **EN:** Set v{{version}} · {{count}} queries
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Seti v{{version}} · maswali {{count}}
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.configsTitle`
- **EN:** Configurations
- **SW (machine draft, please correct it):** Mipangilio
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.adaptiveConfig`
- **EN:** Adaptive routing (preset: {{preset}})
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Uelekezaji unaobadilika (iliyowekwa tayari: {{preset}})
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.noModels`
- **EN:** No language models installed.
- **SW (machine draft, please correct it):** Hakuna modeli za lugha zilizosakinishwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.summary`
- **EN:** {{queries}} queries × {{configs}} configs = {{total}} answers
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** maswali {{queries}} × mipangilio {{configs}} = majibu {{total}}
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.keepScreenOn`
- **EN:** Keep the screen on and the app open while it runs.
- **SW (machine draft, please correct it):** Weka skrini ikiwa imewashwa na programu ikiwa wazi wakati inaendeshwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.chatBusy`
- **EN:** Wait for the current chat reply to finish before running an evaluation.
- **SW (machine draft, please correct it):** Subiri jibu la gumzo la sasa likamilike kabla ya kuendesha tathmini.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.run`
- **EN:** ▶ Run
- **SW (machine draft, please correct it):** ▶ Endesha
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.stop`
- **EN:** ■ Stop
- **SW (machine draft, please correct it):** ■ Simamisha
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.stopping`
- **EN:** Stopping…
- **SW (machine draft, please correct it):** Inasimamisha…
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.progress`
- **EN:** Config {{config}}/{{configs}} · Query {{query}}/{{queries}}
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Mpangilio {{config}}/{{configs}} · Swali {{query}}/{{queries}}
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.savedTo`
- **EN:** Saved to {{path}}
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Imehifadhiwa kwenye {{path}}
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.stoppedEarly`
- **EN:** Stopped early — partial results saved.
- **SW (machine draft, please correct it):** Imesimamishwa mapema — matokeo ya sehemu yamehifadhiwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.exportJsonl`
- **EN:** ⬇ JSONL
- **SW (machine draft, please correct it):** ⬇ JSONL
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.exportCsv`
- **EN:** ⬇ CSV
- **SW (machine draft, please correct it):** ⬇ CSV
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.exportFailedTitle`
- **EN:** Export failed
- **SW (machine draft, please correct it):** Kuhamisha kumeshindwa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.runFailedTitle`
- **EN:** Evaluation failed
- **SW (machine draft, please correct it):** Tathmini imeshindwa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.deviceRequest`
- **EN:** Started from a connected computer (request {{id}}).
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Imeanzishwa kutoka kompyuta iliyounganishwa (ombi {{id}}).
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.noRetrieval`
- **EN:** no retrieval
- **SW (machine draft, please correct it):** hakuna utafutaji
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.pbkdf2Body`
- **EN:** Measures the NMB-1 KDF candidate cost on this device (PBKDF2-HMAC-SHA256, 600k iterations). Test-only data — touches no keys, databases, or network. Writes a JSON timing report.
- **SW (machine draft, please correct it):** Inapima gharama ya mgombea wa KDF wa NMB-1 kwenye kifaa hiki (PBKDF2-HMAC-SHA256, marudio 600k). Data ya majaribio tu — haigusi funguo, hifadhidata, wala mtandao. Inaandika ripoti ya muda ya JSON.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.pbkdf2FailedTitle`
- **EN:** Benchmark failed
- **SW (machine draft, please correct it):** Kipimo cha utendaji kimeshindwa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.pbkdf2Run`
- **EN:** ▶ Run PBKDF2 benchmark
- **SW (machine draft, please correct it):** ▶ Endesha kipimo cha utendaji cha PBKDF2
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.pbkdf2Running`
- **EN:** Running PBKDF2 benchmark…
- **SW (machine draft, please correct it):** Inaendesha kipimo cha utendaji cha PBKDF2…
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.pbkdf2Saved`
- **EN:** Saved to {{path}} · provisional: {{verdict}}
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Imehifadhiwa kwenye {{path}} · ya muda: {{verdict}}
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.pbkdf2Title`
- **EN:** PBKDF2 benchmark (quarantine — not production crypto)
- **SW (machine draft, please correct it):** Kipimo cha utendaji cha PBKDF2 (karantini — si kriptografia ya uzalishaji)
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.runFailedBody`
- **EN:** The evaluation could not be completed.
- **SW (machine draft, please correct it):** Tathmini haikuweza kukamilika.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.exportFailedBody`
- **EN:** The result could not be exported.
- **SW (machine draft, please correct it):** Matokeo hayakuweza kuhamishwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `evaluation.pbkdf2FailedBody`
- **EN:** The key derivation test could not be completed.
- **SW (machine draft, please correct it):** Jaribio la utokaji wa funguo halikuweza kukamilika.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.memTitle`
- **EN:** Memory
- **SW (machine draft, please correct it):** Kumbukumbu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.memOk`
- **EN:** Within limit
- **SW (machine draft, please correct it):** Ndani ya kikomo
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.memOver`
- **EN:** Over limit
- **SW (machine draft, please correct it):** Zaidi ya kikomo
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.appMemory`
- **EN:** App memory
- **SW (machine draft, please correct it):** Kumbukumbu ya programu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.current`
- **EN:** Current
- **SW (machine draft, please correct it):** Ya sasa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.peakSession`
- **EN:** Peak this session
- **SW (machine draft, please correct it):** Kilele cha kipindi hiki
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.deviceRam`
- **EN:** Device RAM
- **SW (machine draft, please correct it):** RAM ya kifaa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.headroom`
- **EN:** Headroom
- **SW (machine draft, please correct it):** Nafasi ya ziada
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.detecting`
- **EN:** Detecting…
- **SW (machine draft, please correct it):** Inagundua…
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.storageTitle`
- **EN:** Storage
- **SW (machine draft, please correct it):** Hifadhi
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.segModels`
- **EN:** Models
- **SW (machine draft, please correct it):** Modeli
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.segKnowledge`
- **EN:** Knowledge base
- **SW (machine draft, please correct it):** Msingi wa maarifa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.segAppData`
- **EN:** App data
- **SW (machine draft, please correct it):** Data ya programu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.segFree`
- **EN:** Free space
- **SW (machine draft, please correct it):** Nafasi tupu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.available`
- **EN:** Available
- **SW (machine draft, please correct it):** Inayopatikana
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.lastAnswer`
- **EN:** Last answer
- **SW (machine draft, please correct it):** Jibu la mwisho
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.speed`
- **EN:** Speed
- **SW (machine draft, please correct it):** Kasi
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.firstToken`
- **EN:** First token
- **SW (machine draft, please correct it):** Tokeni ya kwanza
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.tokensOut`
- **EN:** Tokens
- **SW (machine draft, please correct it):** Tokeni
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.totalTime`
- **EN:** Total time
- **SW (machine draft, please correct it):** Muda wote
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.peakMemQuery`
- **EN:** Peak memory
- **SW (machine draft, please correct it):** Kumbukumbu ya kilele
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.emptyInfer`
- **EN:** Answer something first — stats will appear here.
- **SW (machine draft, please correct it):** Jibu kitu kwanza — takwimu zitaonekana hapa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.routingTitle`
- **EN:** Last routing decision
- **SW (machine draft, please correct it):** Uamuzi wa mwisho wa uelekezaji
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.modelUsed`
- **EN:** Model used
- **SW (machine draft, please correct it):** Modeli iliyotumika
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.taskType`
- **EN:** Task type
- **SW (machine draft, please correct it):** Aina ya kazi
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.retrievalUsed`
- **EN:** Knowledge used
- **SW (machine draft, please correct it):** Maarifa yaliyotumika
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.switches`
- **EN:** Model switches
- **SW (machine draft, please correct it):** Mabadiliko ya modeli
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.switchedSince`
- **EN:** Switched since last message
- **SW (machine draft, please correct it):** Imebadilika tangu ujumbe wa mwisho
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.latency`
- **EN:** Latency
- **SW (machine draft, please correct it):** Ucheleweshaji
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.reasons`
- **EN:** Reasons
- **SW (machine draft, please correct it):** Sababu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.routingFailed`
- **EN:** Routing fell back to your normal model for the last message.
- **SW (machine draft, please correct it):** Uelekezaji ulirudi kwenye modeli yako ya kawaida kwa ujumbe wa mwisho.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.engineTitle`
- **EN:** Engine
- **SW (machine draft, please correct it):** Injini
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.engineModel`
- **EN:** Model
- **SW (machine draft, please correct it):** Modeli
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.ctxWindow`
- **EN:** Context window
- **SW (machine draft, please correct it):** Dirisha la muktadha
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.threads`
- **EN:** Threads
- **SW (machine draft, please correct it):** Nyuzi
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.license`
- **EN:** License
- **SW (machine draft, please correct it):** Leseni
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.inference`
- **EN:** Inference
- **SW (machine draft, please correct it):** Ubashiri
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `usageStats.emptyEngine`
- **EN:** No model loaded.
- **SW (machine draft, please correct it):** Hakuna modeli iliyopakiwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.title`
- **EN:** Crash diagnostics
- **SW (machine draft, please correct it):** Utambuzi wa kuanguka kwa programu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.body`
- **EN:** If NIDO closed by itself, the reason Android recorded shows up here. Copy the report and paste it into a bug report: it does not include your messages, notes or memory; a trace may carry a file name or a technical path.
- **SW (machine draft, please correct it):** Ikiwa NIDO ilijifunga yenyewe, sababu iliyorekodiwa na Android inaonekana hapa. Nakili ripoti na ubandike kwenye ripoti ya hitilafu: haijumuishi ujumbe wako, maelezo yako wala kumbukumbu yako; ufuatiliaji unaweza kubeba jina la faili au njia ya kiufundi.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.lastFailure`
- **EN:** Last failure: {{reason}} ({{when}} UTC)
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Hitilafu ya mwisho: {{reason}} ({{when}} UTC)
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.lastJsCrash`
- **EN:** An app failure was recorded.
- **SW (machine draft, please correct it):** Hitilafu ya programu imerekodiwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.none`
- **EN:** No failures recorded.
- **SW (machine draft, please correct it):** Hakuna hitilafu zilizorekodiwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.copy`
- **EN:** Copy report
- **SW (machine draft, please correct it):** Nakili ripoti
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.copied`
- **EN:** Copied
- **SW (machine draft, please correct it):** Imenakiliwa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.clear`
- **EN:** Clear
- **SW (machine draft, please correct it):** Futa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.fmtExitsTitle`
- **EN:** == Latest exits (Android) ==
- **SW (machine draft, please correct it):** == Kufungwa kwa mwisho (Android) ==
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.fmtNoRecords`
- **EN:** (no records)
- **SW (machine draft, please correct it):** (hakuna rekodi)
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.fmtTraceLabel`
- **EN:**   trace:
- **SW (machine draft, please correct it):**   ufuatiliaji:
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.fmtLastCrashTitle`
- **EN:** == Latest Java/JS crash ==
- **SW (machine draft, please correct it):** == Kuanguka kwa mwisho kwa Java/JS ==
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.fmtNone`
- **EN:** (none)
- **SW (machine draft, please correct it):** (hakuna)
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.nativeDiedGenerating`
- **EN:** The last native death happened while generating: {{model}} · nCtx {{nCtx}} · profile {{profile}} · background indexing running: {{reembed}}
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Hitilafu ya mwisho ya native ilitokea wakati wa kuzalisha: {{model}} · nCtx {{nCtx}} · wasifu {{profile}} · uorodheshaji wa chinichini unaendeshwa: {{reembed}}
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.nativeDiedIdle`
- **EN:** The last native death did not happen while generating: {{model}} · nCtx {{nCtx}} · profile {{profile}} · background indexing running: {{reembed}}
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Hitilafu ya mwisho ya native haikutokea wakati wa kuzalisha: {{model}} · nCtx {{nCtx}} · wasifu {{profile}} · uorodheshaji wa chinichini unaendeshwa: {{reembed}}
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.nativeYes`
- **EN:** yes
- **SW (machine draft, please correct it):** ndiyo
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.nativeNo`
- **EN:** no
- **SW (machine draft, please correct it):** hapana
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `crashReport.nativeHold`
- **EN:** After that failure, background indexing is off for this session.
- **SW (machine draft, please correct it):** Baada ya hitilafu hiyo, uorodheshaji wa chinichini umezimwa kwa kipindi hiki.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*
