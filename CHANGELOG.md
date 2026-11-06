# Changelog

All notable changes to NIDO are recorded here. Versions follow
[Semantic Versioning](https://semver.org/); alpha releases are tagged
`vX.Y.Z-alpha`.

## 0.1.76-alpha - 2026-11-06

Two new features, both marked experimental: CPR practice with an
optional rate meter that uses the camera, and messages that travel from
friend to friend when the person you write to is out of range. No
catalog change: the signed catalog keeps offering knowledge-packs-v12.

### CPR practice (Emergency tab)

- **"Practise CPR"**, below the quick guides. It is a training tool
  for a firm cushion or a CPR manikin, never for a person. The screen
  says so at all times and has no call button. The chat never offers
  it. In an emergency NIDO does what it did before: the checked
  emergency number and the NIDO Essentials guide, word for word.
- **A beep on every compression at 110 per minute** (the guide says
  100 to 120). It comes from the phone itself, on its own clock, so it
  keeps the rate when the app is busy.
- **"Compressions only" or 30:2**, with a 6-second pause for the two
  breaths. The voice reads the guide's own lines, says when to give
  breaths and when to go back, and reminds you to switch every 2
  minutes. The screen stays on. Every sentence is the Essentials guide's,
  in Spanish, English and Portuguese, and a test fails if the guide and
  the screen ever differ.
- **Optional: the camera measures your rate** and says "faster",
  "slower" or "good rate". It is off until you turn it on, and only
  then asks for the camera permission. Frames are analysed on the phone
  as they arrive and are never stored, shown or sent. It says nothing
  when it isn't sure.
- Why practice only: a tool that guides or rates CPR on a real person
  is a medical device in the US (21 CFR 870.5210) and elsewhere. NIDO is
  not one. See [docs/CPR_PRACTICE.md](docs/CPR_PRACTICE.md).

### Messages from friend to friend (experimental)

- **When a contact is out of range, your message can reach them
  through another contact you both have**, with no internet and no
  server. It travels in a sealed envelope: whoever carries it can't read
  it, change it or sign as you, and it is padded so its length doesn't
  show. When it arrives, a signed receipt comes back the same way and
  your message shows as delivered.
- **Carrying messages for your contacts is off by default.** Turn it on
  in NIDO › Contacts › "Carry messages for my contacts". A phone carries
  at most 200 envelopes and 2 MB, only from its contacts, and each one
  is deleted after 72 hours or once delivered. The card shows how many
  you carry.
- Received messages show "via friends"; yours show "travelling via
  friends" while a contact carries them.
- Messages in a conversation with disappearing messages never travel
  this way, nor messages over 1,500 characters.
- Mailbox keys are X25519 plus ML-KEM-768 (against future quantum
  computers), signed with the key in your QR. Each lasts 14 days and a
  new one is made every 7.
  The label on the outside of an envelope changes every day.
- It needs NIDO 0.1.76 on all the phones involved. Older versions ignore
  it. What a carrier can still see, and how NIDO compares with Briar,
  Scuttlebutt, Meshtastic, Bridgefy and others, is in
  [docs/RELAY.md](docs/RELAY.md).

### Also

- What NIDO says about itself (what it can do, where it's heading) now
  includes friend-to-friend messages, as an experiment.

### Not tested on a physical phone yet

Both features passed the automated tests only. That includes three
complete simulated phones exchanging a message and its receipt through
the middle one, and the camera meter on synthetic video, with the
phone's Kotlin code giving exactly the same numbers as the reference. The CPR
camera meter, the beep and the friend-to-friend route still need the
owner's round on real phones.

## 0.1.75-alpha - 2026-11-03

Fixes from adversarial testing of the chat's own routing chain
(the same code path the app runs, with hard phrasings in Spanish,
English and Portuguese) and from an outside audit of 0.1.74, plus
every smaller error found while testing this release. No catalog
change: the signed catalog keeps offering knowledge-packs-v12.

### Reminders and calendar

- **"The day after tomorrow" is the day after tomorrow.** "Pasado
  mañana", "the day after tomorrow" and "depois de amanhã" fell into
  the rule for "tomorrow", so the reminder went off a day early.
- **A day of the month on its own keeps its day.** "Recuérdame el 15
  a las 10", "on the 15th" and "no dia 15" lost the day and went off
  tomorrow. They now go to the next 15th that exists (next month if
  this month's has passed, and the next month that has a 31st).
- **"In 1 hour and a half" adds the half hour.** "En 1 hora y media",
  "in 2 hours and a half", "em 1 hora e meia", "y cuarto" and "y 30
  minutos" went off half an hour (or a quarter) early, with "y media"
  left in the title.
- **"Tonight" without a time gets one.** "Esta noche" and "tonight"
  had no date; they are now today at 20:00, as "hoje à noite" already
  was.
- **Cleaner titles.** "Remind me at noon to eat" was saved as "at to
  eat", "lembre-me ao meio-dia" as "ao …", and "next monday", "el
  lunes que viene" and "na próxima segunda" left words behind. A
  "next meeting" in the title is kept.
- **The agenda of a weekday.** "Qué tengo el viernes", "what do I have
  on friday" and "o que tenho na sexta" went to the model, which cannot
  see the calendar. They now list that day's events.
- **"Nota: …" saves the note** in Spanish and Portuguese, as "note: …"
  did in English, and "anota aí: …" is read as Portuguese.
- **"Lee la nota de la receta" finds "Receta de pan".** The article
  was part of the search, so the note was not found.
- **A time or date that does not exist is not saved.** "A las 25:00",
  "7:75" or "el 31 de febrero" saved a reminder with no time that
  never went off, and "el 31 de febrero a las 10" created the event or
  reminder today at 10. NIDO now says it does not recognize that time
  or date and creates nothing.
- **Alarms and wake-ups.** "Pon una alarma para las 7" is titled
  "Alarma" (in three languages), "despiértame a las 7" "Despertar",
  "wake me up at 6" "Wake up", "me acorda às 7" "Acordar" (it was not
  recognized). "Coloca um alarme para as 7" had no time. "Pon una
  alarma mañana a las 6" is at 6:00, not 18:00.
- **A weekday with a number.** "El viernes 13" is Friday the 13th;
  "el viernes 10 llamar" is Friday at 10; "el lunes 2 pastillas" is
  still Monday.
- **More ways to say when.** "Dentro de 10 minutos", "within 10
  minutes", "lembre-me dia 20 de pagar o aluguel" and "no dia 3".
- **Time ranges and several days in the calendar.** "Reunión de 3 a
  5 mañana" was titled "reunión de 3 a" at 9:00; it is now 15:00 to
  17:00 ("from 3 to 5", "das 14 às 16"). "Vacaciones del 3 al 5 de
  diciembre" started on the 5th; it now runs from the 3rd to the 5th.
  "Cena el sábado a las 9" is at 21:00 unless you say "de la mañana".
- **Appointment titles.** "Añade una cita con el doctor" keeps "cita
  con el doctor".
- **Next week and this month.** "Qué tengo la semana que viene",
  "what's on my calendar next week", "o que tenho este mês" and "¿tengo
  algo el sábado?" list your events instead of going to the model. The
  list is in start order and says how many events it did not show.
- **Timers.** "Una hora y media", "2 and a half minutes" and "uma
  hora e meia" set the timer (they went to the chat). Zero, negative
  or longer than 24 hours: NIDO says a timer goes up to 24 hours and
  offers a reminder.

### Memory

- **A negation is not a name.** "Recuerda que mi papá no se llama
  Juan" created a contact named "No Se", "my dad is not named John" one
  named "Not Named", and "my name is not Aldo" saved your name as "Not
  Aldo".
- **The memory no longer claims you never told it.** When nothing
  matches, the answer said "you haven't told me that yet". It now says
  it cannot find it in what you have told it.
- **A fact saved in another language is found.** "Where do I live?"
  finds "vivo en Tucson", and "¿a qué soy alérgico?" finds "I'm
  allergic to peanuts": the words used to save and to ask are matched
  across Spanish, English and Portuguese.
- **Words are matched whole.** "Ana" no longer matches "mañana", nor
  "car" "carne".
- **"How many days until my birthday?"** counts from the saved date,
  yours or a person's (by name or by relationship: "my sister's").
  It used to go to the model.
- **Forget one memory from the chat.** "Olvida mi color favorito",
  "forget that I live in Tucson", "esquece meu endereço": NIDO finds
  the memory, shows it and asks you to confirm before deleting it.
  If several match, it lists them and deletes nothing; "forget
  everything" asks which one, or points to My Memory.

### Answers and tools

- **A generic "the number is …" is checked against the kind of data
  asked for.** Asked for a card number, "El número es 520-555-0147",
  with that number being a phone number in the source, was shown as
  backed by its source. It is now held back, as a sentence that names
  the kind of data already was. Phone numbers are left out of this
  rule so that a correct short number such as "it's 112" is not
  removed.
- **Adding or taking away a percentage is of the amount.** "100 menos
  30%" gave 99.7; it now gives 70, as phone calculators do. "15% de
  200" is unchanged.
- **"Emergency number usa", "U.S." and "U.S.A." find the United
  States.** The Spanish verb "usa" is still not read as the country.
- **A short emergency number from the source is kept.** "El teléfono
  de emergencias es el 112", with "Llama al 112 en caso de emergencia"
  in the source, was removed as unsupported. A 3 or 4 digit number now
  counts as a phone number when the source sentence has it next to
  "call" and the same topic; 911 given as a clinic's phone is still
  held back.
- **Division by zero** says it has no result (it went to the model).
- **"≈" when the decimals are cut.** "1/3 = 0.3333333333" is now
  "1/3 ≈ 0.3333333333"; "0.1 + 0.2 = 0.3" stays "=".
- **No temperature below absolute zero.** "-10 K" or "-500 °F" were
  converted without a word.
- **Errors in your language.** Unit conversion, calendar, dialer and
  messages errors were in Spanish for everyone.

### Documents and chat

- **Scanned pages are read with the three languages.** A photo or a
  scanned PDF in English or Portuguese, with the app in Spanish, was
  read with the Spanish data only. Each language file is checked by
  its hash before the engine starts.
- **Report an answer.** After a thumbs-down, "Report" opens your email
  app with a draft (question, answer and app version) to the address
  in the README. You review it, can delete anything, and send it
  yourself. NIDO sends nothing.

### Repository

- A Google Play readiness review
  ([docs/PLAY_STORE_READINESS.md](https://github.com/Nido007-cmyk/Nido/blob/main/docs/PLAY_STORE_READINESS.md))
  and a store listing in three languages under `fastlane/`. Nothing
  was submitted to Google Play.
- An index of the security and audit reports
  ([docs/security/README.md](https://github.com/Nido007-cmyk/Nido/blob/main/docs/security/README.md)).

## 0.1.74-alpha - 2026-11-03

Fixes from a full audit of every public claim from 0.1.62 to 0.1.72
([docs/security/AUDIT_FULL_0.1.62-0.1.72_2026-11-03.md](https://github.com/Nido007-cmyk/Nido/blob/main/docs/security/AUDIT_FULL_0.1.62-0.1.72_2026-11-03.md)).
No catalog change and no guide text change: the signed catalog
keeps offering knowledge-packs-v12.

### Safety

- **A live emergency is recognised in the way people actually
  write it, in all three languages.** "My dad isn't breathing"
  was not recognised while "is not breathing" was (the
  contraction was missing); "no puedo respirar" and "não consigo
  respirar" were missing while "I can't breathe" was there; and a
  seizure, a heart attack or a stroke happening now were missing
  in some languages. They are now recognised in Spanish, English
  and Portuguese, and their everyday look-alikes ("backstroke",
  "what is a heart attack", "this traffic is killing me") are not.
- **The health gate knows heart attacks, strokes and swallowed
  objects.** "Infarto", "heart attack", "AVC", "ictus" and
  swallowing a battery, pills, a coin or bleach were unknown to
  it in all three languages, so without a guide the model's own
  text could stay on screen. Swallowing only counts with its
  object, so "the ATM swallowed my card" is not a health question.
- **A crisis said in Spanish or Portuguese reaches the crisis
  route.** "I want to kill myself" reached it (the verified crisis
  line of the NIDO Crisis pack, when the pack is installed);
  "quiero matarme", "me voy a matar", "quero me matar" and "vou me
  matar" did not. They now do, as do
  "acabar con mi vida", "acabar com a minha vida" and "take my own
  life"; the everyday idiom of effort ("me voy a matar
  estudiando", "vou me matar de rir") does not.

### Reading documents

- **A text PDF no longer gets a false recognition warning.**
  Since 0.1.68, every PDF with a normal text layer was imported
  with the warning "recognition found no text on its scanned
  pages", although it had no scanned pages. The recognition
  module now first finds which pages are scanned; with none, it
  does not run and says nothing. A PDF whose scanned pages give
  no text still gets the warning.
- **A file's kind is decided by its bytes, as 0.1.68 promised.**
  A known extension used to win without looking: a PDF named
  ".txt" was indexed as garbage text and a photo named ".pdf"
  failed as an unreadable PDF. Clear signatures in the bytes (PDF,
  JPEG, PNG, WEBP, GIF, HEIF) now decide.
- A recognition failure keeps its real cause (for example, the
  language data failing its integrity check) instead of a generic
  "OCR_FAILED".

### Corrections

- The 0.1.73 entry below said that "one correction to the 0.1.72
  entry" was needed "because it was wrong". That was not so: the
  0.1.72 entry never gave the retrieval figure. The facts in that
  item stand (v12 misses the hypothermia question where v11
  missed the traffic accident one, still 201/202), and the item
  now reads as the note on retrieval it is.

### Repository

- Since 0.1.73, the scripts that reproduce the Essentials seal
  checks (the seal ratchet, the clinical hashes and the guide
  citations) are in the repository, so anyone can rerun them; the
  0.1.73 entry did not say so.
- AGENTS.md names the twelve native modules (it said seven), and
  the cryptography document no longer contradicts the alpha notes.

## 0.1.73-alpha - 2026-11-03

Fixes from Claude's audit of the published 0.1.72 (2026-11-03), each
verified against the published bytes before it was fixed
([docs/security/AUDIT_0.1.72_2026-11-03.md](https://github.com/Nido007-cmyk/Nido/blob/main/docs/security/AUDIT_0.1.72_2026-11-03.md)).
No catalog change and no guide text change: the signed catalog
keeps offering knowledge-packs-v12.

### Memory and answers

- **"¿Cuándo es mi cumpleaños?" finds the birthday when the note
  says it with "el mío".** A fact saved as "…y el mío es el 3 de
  mayo" was not read as your own birthday: the pronoun forms
  without the noun after them ("el mío", "mine", "o meu")
  matched no rule, so the question went unanswered or took
  another reading. The pronoun now counts when its own clause
  carries an extractable date, in Spanish, English and
  Portuguese; the explicit forms ("mi cumpleaños es…") keep
  winning, as before.
- **A short sentence no longer drops the "no" of the long guide
  sentence it shortens.** When an answer copied a short clause
  out of a longer source sentence, the grounding check compared
  it only with short source sentences, and a negation that lived
  in the long sentence never entered the comparison. The check
  now also reads the long source sentence the clause came from.
  The judge's own thresholds are untouched, and a regression
  sweep of 14,583 answer shapes over the Essentials chunks
  changed no verdict and no text.
- A note on retrieval in knowledge-packs-v12: the v12 Essentials
  pack's e5 recovery is 201/202 and the question
  it misses is the hypothermia one; the v11 pack missed a
  different question (the traffic accident one, which v12 now
  answers). The missed question changed because the family
  search keys are part of what the search embeds. The figure
  stays above its 90% requirement and the first-aid gate holds
  at 38/38.
- The two Portuguese recovery variants that no measured dose
  can crown without breaking the first-aid gate stay named
  as the declared frontier (variants 12/14), as in 0.1.70.

## 0.1.72-alpha - 2026-11-03

The catalog release. 0.1.71 already carried the Essentials text
with its family search keys in the repository, but the published
pack was still the v11, built without them. The signed catalog
now offers knowledge-packs-v12, built from a commit in main with
the keys inside the pack. No app code changes and no guide text
changes: stripped of the key lines, the v12 source is
byte-identical to the v11 source, and the seal ledger is
untouched, because the clinical hash never counted the keys.

### Knowledge packs

- **The family questions reach their guide.** On a phone, the
  coverage gate turned away the way families actually ask: a
  fever of 39, paracetamol for a 20 kilo child, a scorpion
  sting, a snake bite, a swallowed coin, a faint, a cut that
  keeps bleeding. In v12, 197 of the 568 chunks carry the
  family question keys and every one of the 174 guides has
  them. Checked against the published pack bytes: the coverage
  battery passes 5/5 groups on both search engines (the same
  battery fails 4 of its 5 groups on the v11 bytes), and the
  first-aid gate holds at 38/38. Essentials ships as
  knowledge-packs-v12: 174 guides · 568 chunks · 1,228,800
  bytes per file, counted from the v12 release.
- The two Portuguese recovery variants that no measured dose
  can crown without breaking the first-aid gate stay named
  as the declared frontier (variants 12/14), as in 0.1.70.

## 0.1.71-alpha - 2026-11-03

Fixes from Claude's audit of the published 0.1.70 (2026-11-03), each
reproduced on the published code before it was fixed
([docs/security/AUDIT_0.1.70_2026-11-03.md](https://github.com/Nido007-cmyk/Nido/blob/main/docs/security/AUDIT_0.1.70_2026-11-03.md)).

### Answers

- **A wrong dose written as an instruction is no longer sealed as
  grounded.** The judge only checked a dose when the answer said
  "the dose is…", and its digit rule skipped single digits, which
  is how almost every dose is written. On 0.1.70, "Take 5 tablets"
  against a source saying 2, "Give 6 puffs" against 2, "5 ml"
  against 10 and, with the real chest-pain guide, "chew 8 low-dose
  aspirins" against "2 to 4" came out grounded with a citation.
  Now each figure is tied to its dose unit (tablets, ml, mg, drops,
  teaspoons, puffs, inhalations, sprays, aspirins…), with ranges and
  numbers written as words, and a figure the sources contradict for
  that unit withdraws the sentence. Every numbered sentence of the
  174 Essentials guides, checked against its own guide, keeps the
  verdict it had before.
- **"Como se chama o meu pai?" answers with the saved name.** In
  Portuguese, the masculine "o meu" was missing from the question
  form, so it answered "você ainda não me contou isso" for any male
  relative already saved.
- **Saving a fact with a date in Portuguese suggests a reminder too**
  (and "setiembre" and "the 10th of May" count as dates).

### Essentials source

- **The repository now holds the Essentials text that was
  published.** The re-verified v11 guides (with their corrections,
  such as parking before the crash, not beyond it) lived only on a
  build branch; the main tree still had the older text, so the next
  build from it would have undone them. The source, its
  verification ledger and its seal baseline are now in the tree,
  the floor record points at v11, and the family question keys of
  the coverage fix (C-03) are kept on top of the v11 text. **Those
  keys were never in the published packs:** v10 and v11 were built
  from a source without them, so on a phone 11 of the 22
  questions of that battery still die at the coverage gate. They
  reach phones with the next Essentials pack, which needs the
  maintainer's catalog signature.

## 0.1.70-alpha - 2026-11-03

### Answers

- **A dose is judged even when the question never names
  one.** The datum rule used to run only when the question
  asked for the datum itself, so a wrong dose sealed as
  grounded under "how do I take the syrup?" and was
  withdrawn only under "what is the dose?". A claim that
  types itself now opens the rule on its own; the leg's
  perimeter is unchanged. (Suite at close: 5,679 tests.)
- **Portuguese doses are judged at last.** The Portuguese
  copula was read folded, so the dose leg never fired in
  Portuguese: "30 colheres" against a 20 source sealed as
  grounded. The copula is now read as written in both
  consumers. (Suite at close: 5,679 tests.)
- **Spelled-out numbers and fractions enter the judgment.**
  Figures written in words reach the judge from the same
  single source the omissions box uses, and kitchen
  fractions carry their grammar in both. A single digit
  now counts in the typed dose leg too, where before
  "the dose is 9 ml" against "take 5 ml" sealed because
  one digit was never judged. (Suite at close: 5,679
  tests; the single-digit leg closed earlier, at 5,624.)
- **Numeric dates are judged under the turn's own
  convention.** A "d/m" date is judged when the context
  decides the convention (rule R6); the bare transposition
  stands as measured ambiguity, not forced either way.
  The named-date twin now declares the turn's convention,
  and a new rule (R7) teaches a year conflict: same day
  and month, two different written years in note and
  answer, is a conflict in numeric and named form alike.
  (Suite at close: 5,679 tests; the twin and R7 closed
  later, at 5,763.)
- **English dose units join the table, the negation
  correction reaches short sentences, and the inhaler
  family is a dose unit in all three languages.** "Puffs"
  and "sprays" entered both dose tables; "inhalaciones",
  "inalações" and "inhalations" followed, censused
  against the served corpus; and the box that teaches
  omissions no longer keeps a dose list of its own — it
  consumes the judge's list, so parity holds by
  construction, not by habit. (Suite at close: 5,787
  tests.)
- **A card number is no longer taught as a phone number.**
  The omissions box presented a 15–16 digit card string
  as a phone the source had omitted, by two paths at
  once (the cluster and the generic word "number"); both
  are closed, and the emergency floor (911) is intact.
  (Suite at close: 5,763 tests.)

### Reminders and memory

- **The name you saved is the one that answers, in Spanish
  and Portuguese too.** "¿Cuál es el nombre de mi mamá?"
  had no Spanish pattern and the saved card was invisible
  to the generic route: NIDO answered "you haven't told
  me" while holding it. Facts dictated as "se chama",
  "name is" or "is called" are served by the name route,
  asking for your own name answers with what is saved,
  and the Portuguese possessive agrees with the person
  served ("Seu pai", "Sua mãe"). (Suite at close: 5,735
  tests; the first pattern closed at 5,613.)
- **Reminders and memory follow your words in the three
  languages.** Portuguese reminders set their time in
  words ("em duas horas", "daqui a duas horas"), the
  singular hour sets its own ("a la 1", "à 1"),
  "setiembre" joins the month grammars that lacked it,
  saving and forgetting in Portuguese take their route
  ("guarda na memória", object-first forgetting), and
  each request's category is detected in all three
  languages, not only in Spanish. (Suite at close: 5,735
  tests.)
- **The birthday seat learned the same discipline as the
  name seat.** With only a grandfather saved, asking for
  the grandmother now gets the honest answer in both
  directions; the possessive comes from the record
  served, and the Portuguese question for the grandfather
  enters the route at last. The Spanish and English name
  frames ("el nombre de… es", "the name of… is") serve
  their facts, and a name no longer swallows the
  conjunction after it ("João e." is "João."). (Suite at
  close: 5,799 tests.)
- **Two birthdays in one note no longer cross their
  dates.** The date is extracted from the segment of the
  person asked about, not from the note's first clause —
  with the note split by conjunctions, by periods or
  semicolons, or by exclamation and question marks, and
  asking for your own birthday over a combined note no
  longer serves your grandmother's date. A separator
  followed by a glued comma only stays an aside when the
  span it would close carries no date of its own, so a
  real separator is never disarmed by its comma. (Suite
  at close: 5,831 tests.)

### Knowledge packs

- **The pack builder's cache is named by the content it
  embeds.** The embedding cache used to be keyed by chunk
  count alone, so a green build could crown answers over
  a cache that was not its source's. The cache file now
  carries the hash of the exact embedding manifest
  (chunk text, model, dimensions), with a size guard
  that fails out loud.
- **Fourteen recovery seats corrected in the Essentials
  source.** The guides crown for the phrasings people
  actually use: twelve crowns recovered (the Heimlich
  guide and the heatstroke guide among them, in Spanish;
  bleach and disaster in English), each seat measured
  with the first-aid gate beside it — 38/38 throughout.
  Two Portuguese windows that looked closed opened with
  their measured dose: the oral-rehydration guide and
  the burns guide, each to third place with the gate
  intact. Three words of visible Portuguese text were
  corrected.
- **Essentials, re-verified guide by guide.**
  Every topic was checked claim by claim against its
  official source, with the citation layer built per
  claim (official source, exact quote, locator, check
  date); the `verified` seal stands only on the topics
  that passed, and any topic closed by correction names
  its before and after with its source. Essentials
  ships as knowledge-packs-v11: 174 guides · 568 chunks · 1,163,264 bytes per file, counted from the v11 release.
- The two Portuguese recovery variants that no
  measured dose can crown without breaking the first-aid
  gate are named in the pass's coverage (variants 12/14).

### Data and stability

- **Downloads keep their grip per file.** The wake lock
  that keeps the screen on during a download counted
  files, not holds: releasing one of two holds on the
  same file dropped the native lock and left the other
  hold dangling. Holds are now counted per file, and
  the lock releases only when the last one does.
  (Suite at close: 5,735 tests.)
- **A legacy key-rotation staging path is removed.** Its
  writer has been dead since before 0.1.69 shipped and
  the recovery window runs at every start; the reader
  now reads only the current array. English ordinal
  dates ("10th") are fixed in fixtures as the accepted
  behaviour of the date grammars. (Suite at close: 5,624
  tests.)

Battery 5,857/5,857 in 340 files (+249 over the 0.1.69
suite, every added test a fixture of this chain); jest
13/13 suites, 52/52; tsc 0. Tip `80851c9`, the frozen tip
of the fix chain; the publication act's own commits
follow it.

### Project information

- The "NIDO development" card in About (0.1.65) remains
  the project's note on voluntary contributions; NIDO is
  free and complete without contributing anything.
- The signed download catalogue is re-signed over what
  the CI published: its signature covers 14 fields of
  each of the 32 entries, and NIDO Essentials
  now points at knowledge-packs-v11 — 174
  guides, 58 in each of Spanish, English and
  Portuguese. The v11 files were counted from the
  published release itself (174 guides · 568 chunks · 1,163,264 bytes per file) before the catalogue moved, and
  NIDO Local stays on knowledge-packs-v9.

## 0.1.69-alpha - 2026-11-02

### Answers

- **The requested fact is judged by its kind.** When a question
  asks for a specific fact, only source sentences that carry that
  kind of fact compete (a room, a time, a date, a dose, a phone);
  a 15–16 digit card string no longer has the shape of a phone,
  and a tie between facts with different digit shapes is no
  longer broken by order — nothing is substituted. A kept
  sentence that names the requested kind but carries figures
  matching no fact of that kind in the evidence is replaced by
  the true fact or withdrawn, and no longer counts as a delivery
  that silences the check. A single carrier of the kind serves
  even across languages. (Suite at close: 5,067 tests.)
- **The omission check needs a topic and a category.** Function
  words no longer count as shared topic, and the sentence the
  source card teaches must carry the omitted fact's category;
  one substantive foreign word suffices when the category is
  shared, so the canonical emergency-number omission warns again
  with the true sentence. (Suite at close: 5,067 tests.)
- **The memory witness demands the datum in the promoting
  fact.** A memory-probe promotion now computes a witness from
  the saved facts themselves: for time, number and date
  questions the promoting fact must contain an instance of that
  class (a clock time, a digit run, a named or numeric date),
  not just the word for it; without the witness the grounding
  net judges the prose as before. The composition mirror
  computes the same witness. (Suite at close: 5,086 tests.)
- **Scores are normalised per corpus before fusion.** Each
  lexical source z-scores its own (gate-filtered) candidate list
  and squashes it through a sigmoid before the mix, per pack and
  for the device index alike, never over the union; raw scores
  and the fusion itself are untouched. A degenerate source
  (fewer than 3 candidates or no spread) is scaled by its
  maximum capped at the neutral point, so a lone weak chunk
  cannot crown over a genuine hit from another corpus; with a
  single source in play the order is unchanged. (Suite at
  close: 5,274 tests.)
- **The coverage gate stops killing real questions.** Every
  Esencial guide now carries a `questions:` key with the
  family's own phrasing (dictation forms, house synonyms
  child/kid and alacrán/escorpión, the brand names families
  use — Tylenol, EpiPen — in the English keys, plus 1–2
  Portuguese bridge questions per guide), and the lexical
  prefix P1 matches five-letter words by their start, so
  "me quemo" reaches the burns guide. Guides with their own
  emergency section carry section keys too, so the answering
  chunk itself passes the gate. Measured on the real gate:
  clean battery 4/14 to 14/14, human phrasing 4/11 to 11/11,
  Portuguese bridge 0/2 to 2/2; all eighteen dead questions
  revive and no control moved. Declared price: the wheel
  question now admits exactly one guide ("Terremoto", via
  the shared `camb*` prefix), frozen in the permanent
  fixture as the only tolerated admission; the fever guide
  has no mg/kg table and no key pretends it does. The
  Portuguese edition of Esencial is still its own batch
  (C-04); the bridge keys are the measured interim.
  (Suite at close: 5,280 tests.)
- **The check now compares measures in their unit and inside
  their range.** The grounding check learns the units the
  first-aid guides use (%, drops, tablets, days, months,
  years, with the dose qualifiers drops/l and ml/kg·mg/kg),
  converts the written measures (a teaspoon is 5 ml, a
  tablespoon 15 ml, a week is 7 days), reads "every N hours"
  as 24/N times a day and figures written out in words on
  the dose path, and fuses evidence ranges so a figure
  inside a range counts as the same figure. A dose or
  duration the source does not support no longer passes —
  a "3 days" claim with no measures behind it no longer
  slips through by omission — and the guide answer whose
  figure sits inside its range is no longer dropped as
  unfounded. Declared remainder: a short sentence carrying
  two figures inside one range can still be held back by
  the check's lexical novelty rule, which counts figures
  as content terms; measured and named in the batch
  report, it stands for the fresh verification to judge.
  Closing micro-batch C-08b (on the A5-03 defect the
  adversary caught inside this cure) adds the singular of
  the drop to the tables: "1 gota" and "una gota" now fire
  like "1 comprimido", in digits and in words, and "1 drop"
  forms its measure; declared remainder: "one drop"
  written out in English still does not pass the
  number-words gate — the literal border of the registered
  scope, named in the C-08 montage beside Q-ADV5.
  (Suite at close of C-08: 5,299 tests; with C-08b:
  5,337 tests.)
- **Dates are checked against the calendar, not just the
  digits.** The verifier gains a calendar of its own
  (grammars in Spanish, English and Portuguese) and a date
  leg beside the figures: a claim whose weekday contradicts
  the source ("Monday, November 10, 2026" against a note
  that says Tuesday) is withdrawn like a wrong figure, and
  relative dates are judged against the day of the turn —
  an appointment sealed as "yesterday" no longer grounds
  itself. Declared remainders: the conflicts box only shows
  a date conflict when the source has a paired sentence to
  show (the verifier leg still withdraws the unpaired one),
  and a date that does not exist in its named year (Sunday,
  February 29, 2026) is left unfixed and unjudged by the
  date rules — it never rolls into March 1; both stand for
  the fresh verification to judge.
  (Suite at close: 5,317 tests.)
- **Digits bind to their own datum kind inside a sentence.**
  The typed-datum rule now counts a figure for a kind only
  when it is bound to that kind's anchor within the same
  sentence: a measure word binds the number right before it,
  type words and date names bind nearby figures inside a
  tightened window, and phone, card, clock and date forms
  bind themselves. A compound appointment sentence therefore
  no longer lends its figures across kinds — the room is not
  sealed as the day of the month, the date is not the room
  number, the dose is not 214 ml — and a crossed claim is
  replaced by the carrier sentence, as with separate
  sentences. The phone bridge gains an owner guard: when the
  only phone in the evidence names an owner other than the
  entity asked about, the bridge does not fire and that phone
  is not served as the answer. The memory-probe witness now
  requires EVERY requested datum class (time, number, date)
  in the promoting fact, not just one; with a single class or
  none, its outcome is unchanged. Declared prices: a figure
  legitimately far from its type word stays unbound (the
  substitution serves the whole carrier sentence, where the
  true datum lives); owners named outside the closed
  constructions are not seen; two classes split across two
  facts lose the exemption and go through the net.
  (Suite at close: 5,336 tests.)
- **When a pack holds no source for what is asked, it falls
  to the honest answer.** Two presence signals now sit behind
  the coverage gate, decided per corpus: if a question's
  topic term appears nowhere in a large candidate pool and
  nothing served matches a distinctive term, that corpus
  returns nothing instead of lending a neighbour guide; and
  when a datum-shaped question (which address, what price,
  which email) names a datum kind that appears nowhere in
  the pool, that corpus falls too — unless a served item
  comes from the user's own documents, which are exempt.
  What has a source is answered as before, measured after
  the cure: "what do I do if my child has trouble breathing"
  serves the asthma guide at its head (9 through the gate,
  9 after the signal), and the wind-direction question keeps
  its hurricane guide, the datum-kind term being present in
  that corpus. Named remainder (A4-02): "How much does an
  ambulance cost?" still admits exactly the same five
  fragments (guides 11, 12, 21, 35, 41), now pinned by a
  fixture so the admitted set cannot change in silence; the
  signals do not stretch to catch it, by design.
  (Suite at close: 5,353 tests.)
- **The datum frame is read per sentence, and procedure
  vetoes it.** After adversarial pass 8 caught the datum
  signal's frame disagreeing with the settled probe set
  in both directions, the frame is now searched per
  sentence — bounded to the sentence carrying the datum
  kind, after at most three filler tokens from a closed
  list — and its inventory gains the "a qué" form and
  the dictated need ("necesito", "i need", "eu preciso":
  asking for the datum as a need is asking for it). A
  procedure opener ("qué hago…", "how…", "o que
  fazer…") vetoes the signal even when a datum kind is
  mentioned in passing, so "what do I do if the
  confirmation email never arrives?" keeps the answer
  the gate served, while the consulate question still
  falls and the symmetric-damage controls do not move.
  Declared price: the first-frame veto is deliberately
  conservative — a mixed question that opens as
  procedure is served whole even if it later asks a
  genuine datum question. (Suite at close: 5,359 tests.)

### Emergencies and Research

- **The emergency gate hears victims and events together.** The
  body-signal list grows (neighbour, patient, passenger, family
  in dictation forms, children/kids as their own entries) and
  the stems gain fainted / drowned / unconscious in Spanish,
  English and Portuguese under the same body-context discipline;
  a new telegraphic face covers subject-less reports with a sign
  word in participle or state form. Filler matches are cut by
  the remainder rule ("helpful", "babysitter", "personal" no
  longer declare a situation), and new vetoes cover product
  safety topics ("choking hazard") and the "choke back" idiom.
  Measured: 0/11 to 11/11 on the demonstrated set, no control
  moved. (Suite at close: 5,086 tests.)

### Reading documents

- **Import warnings persist, each with its own reason.** A new
  additive table keeps every file's warning (reason, recognition
  code and message, previous name) inside the existing knowledge
  database; the collection card reads them from the database on
  every refresh, replaces them per file on reimport, cascades on
  collection delete, and dismisses by (collection, reason)
  group. The single lumped "gave no text" sentence is gone: each
  reason carries its own string in Spanish, English and
  Portuguese. (Suite at close: 5,042 tests.)
- **A document's identity is the fingerprint of its content.**
  Imports are deduplicated on the SHA-256 of the normalised body
  before chunking and embedding: an identical file (renamed or
  not) does not enter and is not an error — the warning names
  the collection and the name it already lives under; a file at
  90% or more shared chunks enters whole as a new copy, flagged
  as similar, never silently substituted; a pre-existing
  duplicate registry is built lazily, best-effort, and deletes
  nothing. Recognition sinks are per file, so two files with the
  same name no longer inherit each other's marks. (Suite at
  close: 5,042 tests.)
- **The built-in encyclopedia grows from 300 to 858
  topics, and no seeded document is lost.** 540 new
  Wikipedia introductions across 185 concepts in Spanish,
  English and Portuguese (300→858 documents with 18
  capital annexes), captured from a table rebuilt
  independently of the original manifest and verified
  title by title against the Wikipedia API (555/555
  exist; the two concept drifts resolved in the table,
  not in the capture: Spanish "Ballenas" is captured as
  "Mysticeti", "Cambio climático global" as
  "Calentamiento global"). Every captured document
  carries its canonical datum inside its first 3,000
  characters (522 directly, 18 through their capital's
  annex). The 300 published documents stay byte-identical
  and the downloadable levels do not change. Seeding now
  derives a unique id per document: the old derivation
  produced 762 distinct ids for 858 documents and 96
  were silently overwritten at seeding time (INSERT OR
  REPLACE), one of them already published; the 300
  published ids are exactly unchanged. The snapshot date
  is the real capture date, 1 November 2026 (C-09).
  Declared remainders for the fresh verification, all in
  retrieval terrain and pinned by a permanent fixture
  with the measured outcomes: the Portuguese "Austrália"
  crowns for the Spanish and English capital questions
  (the served answer is correct, in the sister language);
  the coverage gate withdraws the correct Quixote
  documents for the framed "who wrote… according to the
  corpus" questions; and the fixed local harness loses
  hit@1 (60%→40%) and MRR (0.600→0.483) to competition
  from correctly seeded documents, the expected document
  staying in the top 3. (Suite at close, knowledge-packs
  repo: 4,335 tests.)

### Knowledge packs

- **Esencial's Portuguese edition gains its source,
  and knowledge-packs-v10 is built from it.** The 58
  first-aid guides now exist in the packs repo as a
  full pt-BR mirror of the Spanish — digit parity
  58/58 net and raw, structural mirror exact, every
  figure checked against the truth table in its seat
  (guide 26's oral serum with its half teaspoon of
  salt, guide 48's 5–6% bleach at 2 drops per litre)
  — and the candidate measures 174 guides (58/58/58),
  566 chunks (Spanish 192, English 183, Portuguese
  191) and 1,146,880 bytes per file, both model files
  reproduced byte-for-byte from the tip's sources.
  Retrieval checks after the batch: bge (English, as
  CI) 64/64; e5 across the three languages 196/202
  (Spanish 66/69, English 62/64, Portuguese 68/69 —
  the single Portuguese miss is named in the batch
  report and its Spanish twin fails the same way
  against pre-existing Spanish, so it is pack
  retrieval behaviour, not a Portuguese defect).
  Portuguese chunks are now attributed «baseado em»
  in the built artefact. The published v6 asset
  already served these 174 guides; what was missing
  was their source — a v10 built without it would
  have shipped 116 guides. Declared: the strict
  first-aid battery (min 1.0) reads 32/38 — see "What
  this version does not claim"; and the builder's
  embedding cache, keyed only by chunk count, is a
  named charge for a later batch (every candidate
  measured here was rebuilt with the cache cleared).
  (Suite at close, knowledge-packs repo: 4,331/4,335
  tests in 267 files — the four misses are wall-clock
  assertions in foreign zones, shown flaky in
  isolation; tsc clean.)

### Privacy and security

- **The Emergency screen's field uses the private input.** The
  last raw text field in the app now goes through the incognito
  input like every other screen, and a permanent guard test
  fails if any future field imports the raw input again.
  (Suite at close: 5,093 tests.)
- **Orphaned collection exports are swept at start.** Exports
  write a registered live name and keep their content and share
  dialog; at start, a fire-and-forget sweep removes top-level
  export files that are neither live nor the named telemetry
  file, without touching subdirectories, the database or the
  key, and without blocking start — it cleans even while the
  biometric gate is still closed. (Suite at close: 5,093 tests.)
- **Crash text is scrubbed in two layers.** The native layer
  scrubs the session record before it is written; the report
  formatter masks file paths, brace and bracket content runs and
  over-long message lines in the crash block only, keeping
  classes, frames and the diagnostic message. The card says, in
  Spanish, English and Portuguese, that the report is cleaned
  before it can be copied. Declared residue: conservative, not
  hermetic — a short user string inside the first characters of
  a message, outside braces, can still pass. (Suite at close:
  5,093 tests.)
- **PRIVACY.md says what the biometric gate is, and names the
  Bluetooth window.** Biometrics are an access gate checked by
  Android (NIDO never sees a fingerprint or a face; without a
  screen lock the app warns and does not offer it), and pairing
  can make the device's name visible for up to five minutes.
  Policy text only; the "Last updated" line is the version
  lane's. (Suite at close: 5,093 tests.)
- **The secure-screen header names its two physical checks.**
  Comment only: the FLAG_SECURE plugin's note now lists exactly
  what the owner's round verifies on the published build
  (screenshot gesture blocked or black; Recents thumbnail
  black). No behaviour change. (Suite at close: 5,093 tests.)

### Reminders and memory

- **"Remind me that…" creates the reminder, and saves no false
  fact.** The reminder extractor now peels one complementiser
  after the closed verb set in Spanish, English and Portuguese
  (polite, dictated and mixed forms included), with a double
  interrogative guard and a closed residue list; English titles
  no longer carry the "that". The composition suite pins the
  double outcome: the reminder is created and the spurious fact
  ("compre leche mañana") is not saved. Declared seam: a
  remember-family capture carrying a declared calendar date and
  no event marker is decided by memory, the same outcome the
  "remember that…" path gives it today. (Suite at close: 5,126
  tests.)
- **Facts fold accents, keep the ñ, and replace by attribute.**
  Fact comparison folds diacritics with the ñ protected by a
  private marker, so Lucía and Lucia merge while "año" and "ano"
  stay apart. A bounded attribute pass in the save path gives a
  single-value attribute's new value the place of the old one
  instead of letting both live. A typo in the trigger verb is
  repaired only under four locks (position, not a real word, a
  single distance-1 candidate between QWERTY neighbours, an
  order context behind it). (Suite at close: 5,206 tests.)
- **Forgetting works in the eleven real forms.** Every silent
  forget form now returns the memory-forget guide instead of
  falling through, with the "eso/esto" guard intact and the
  timer safe: "borra el temporizador" still deletes the timer,
  because the timer rules run first. The fused-question repair
  also reaches the generic memory shape and the fact scoring
  ("¿cómo se llama mima?" scores "mamá"). The frame "Guarda el
  teléfono de la clínica: 520-555-0147" saves the whole fact
  without a "que"; note subjects are not caught by it and "Anota
  que…" still saves a note. Spanish frame measured; the English
  and Portuguese colon forms are a named remainder, not built.
  (Suite at close: 5,206 tests.)
- **Classifiers send each question to its place.** Bare time and
  date are answered at once from an anchored set mirrored from
  the router (greetings and polite tails allowed, Portuguese
  parity new), while a time with a place, event or object
  retrieves again. Task patterns gain Spanish and Portuguese
  twins (translate, code) with labels for summarize, extract and
  compare; "código postal" stays chat. Polite creative frames
  enter creation in Spanish and Portuguese. The emergency-number
  family leaves the contact pattern for the knowledge route via
  a closed public-services guard, and the research gate narrows
  only in the number class — the emergency text check itself is
  untouched; "¿cuál es el número de Ana?" stays an action.
  "¿Recuerdas qué…?" with a document noun leaves memory for the
  document route, genuine memory untouched. (Suite at close:
  5,261 tests.)
- **Research cites only what it cites, and summaries keep the
  beginning.** Decomposition deduplicates folded lines and
  discards drift lines only when another survives — a line the
  emergency gate intercepts is never drift-discarded, and the
  sealed emergency fixture passes unedited. Citations are the
  chunks the final answer actually cites, renumbered to the
  filtered list; no citations, empty list. Session summaries are
  progressive, in chunks from the first turn, in the
  conversation's language. A pending choice still dies with the
  process, now pinned by a composition test as the design.
  (Suite at close: 5,261 tests.)

### Data and stability

- **The encrypted layer, measured against the real engine
  (B-01):** key rotation is asserted by reopening against
  real SQLCipher, the migration matrix (ten states, with a
  live WAL and built interruptions) and the staging
  convergence (ten cases) run against the engine, and the
  shared test harness imports the real handshake in 13
  suites without moving a single count or a single
  assertion. No production changes.
- **The house, cleaned on the inside (B-resto):** two dead
  pieces removed, with their death proven by two routes
  before deleting (the rotation function nobody called,
  with its test, and the brand module nobody read, with
  its directory); the live rotation is asserted by
  reopening after the deletion (21/21 with the fire
  suite, the multidb one and the boot-wiring one); a new
  guard hunts emergency-guide keys missing in any
  language against the live source (36/36 today); the CI
  branch can no longer skip the run against the real
  engine; the download wake-lock semantics, pinned by
  its test with its named deviation; and the staging's
  historical-format branch is kept as a written decision,
  working. Arithmetic re-summed from the whole diff:
  +1 net file, +7 tests, jest delta 0.

### Performance

- **The user database's vectors, in int8 (P-01 step 1):**
  each stored vector goes from 1,536 B (float32) to
  384 B (int8) — measured on disk over a test database:
  199,680 B → 49,920 B in 130 vectors; at 20,000 chunks,
  a saving of 23,040,000 B in the user database alone.
  Aptitude was measured before touching code with its
  probe (p99 |Δcos| 0.000782 against the 0.01 bar; 28/28
  served sets identical; the R-03/R-04 literals
  re-proven in float32, mixed and migrated). Dual reader
  by length, no schema change; the corrupt-length row
  is excluded with a named warning; bodies leave the
  scoring `SELECT` and hydrate only for the survivors;
  an `embedding_storage_format` stamp and an in-place
  migration by batches, idempotent and resumable, that
  parks during generation; new writes are born in int8
  from the only two producers.
- **The APK weight cuts, with their table judged exact
  piece by piece over the published 0.1.68 APK:** the
  `hexagon_opencl` pair and llama's HTP assets leave
  through the packaging plugin (the pair through its
  jniLibs layer; the HTP assets through a fourth layer
  that prunes the merged-assets intermediate, because
  the packaging exclusions never reached them in the
  real build — 18,167,464 B);
  BouncyCastle's 5 post-quantum tables leave through
  the exclusions property (4,138,070 B stored; the
  decompressed figure, 8,164,531 B, is not the saving);
  fontbox's CJK maps leave through the amended rule,
  with the correction annex's ten files inside the
  count and exact survivors Identity-H, Identity-V, H,
  V (1,201,763 B). **Total: 23,507,297 B**, confirmed by
  the second route (the simulated APK removes 99
  entries summing exactly the total; the 397,060 B of
  file difference are structural ZIP overhead) and by
  the third route, the real binary: CI run 41381127115
  built the corrected tip, the listing judge passed on
  the built APK, and its listing drops exactly those
  99 entries with the same stored bytes (the built file
  itself is 20,784,147 B lighter than the 0.1.68 file —
  the difference against the total is the JS bundle's
  growth with the 858-article corpus, +2,801,136 B
  stored, plus ZIP structure). The
  listing's judge lives in CI (`check-apk-trims.py`)
  and fails the build if anything cut returns or
  anything kept goes missing. Generation threads come
  from the device's real cores (no probe → 4 · ≤4 → 2 ·
  5–6 → 3 · 7–8 → 4 · >8 → 6; the explicit option always
  wins). Execution telemetry prunes itself to the 1,000
  most recent rows inside the same transaction as the
  insert, proven against real SQLite. P-07 verified
  without code: zero diff over P-01's ground, and its
  accounting is not charged here.

### Surface

- **About tells the truth about the network** in all three
  languages: it no longer promises that everything stays on
  this device, and its referral names the real section in
  each language, verified by program. **The guide teaches
  Emergency, Deep research and Scanned documents** — 12 new
  examples executed by the real routers, 129/129 with
  hygiene — and the documents tip stops denying that image
  scans are read. **Small-text contrast meets its bar pair
  by pair**, recomputed to the hundredth (worst corrected
  pair: 4.61 on hover, bar 4.5). **Touch targets reach the
  house bar**: composer buttons and microphone 44×44, mode
  chips, footer and country selector at 44 effective or
  more, and the panic box grows 32→44 high with its hold
  gesture byte-identical (3-second hold, release cancels,
  proven by the full-file diff). **Key-store errors speak
  plainly** in the three languages (the "Fail-closed:"
  segment replaced in exactly 24 strings, nothing else in
  them touched), **the benchmark text drops its developer
  clause** while keeping the in-app route, and **the
  pairing notice answers in the words its question
  offered**, in both sites, with the accepted tokens
  unchanged byte by byte. Battery 5,583/5,583 in 337 files
  (+12, all from the new guide examples); jest 13/13
  suites, 52/52; tsc 0. Tip `b2ebdf4`.

### Project information

- The "NIDO development" card in About (0.1.65) remains the
  project's note on voluntary contributions; NIDO is free and
  complete without contributing anything.
- The signed download catalogue is re-signed over what the
  CI published: its signature covers 14 fields of each of
  the 32 entries, and NIDO Essentials now points at
  knowledge-packs-v10 — 174 guides, 58 in each of Spanish,
  English and Portuguese. The v10 files were counted from
  the published release itself (174 guides, 566 chunks,
  1,146,880 bytes per file) before the catalogue moved, and
  NIDO Local stays on knowledge-packs-v9.

## 0.1.68-alpha - 2026-10-31

### Reading documents

- **NIDO reads photos and scans now.** Importing an image or a
  scanned PDF runs text recognition entirely on the phone
  (Tesseract, with its English, Spanish and Portuguese data
  hash-checked before the engine starts) and indexes the text
  with its provenance marked, so an answer can say it came from a
  scan. In a build without the recognition module, a scanned PDF
  names its cause instead of importing empty. A file's kind is
  decided by its own bytes, not by its name.
- **Imports no longer eat each other.** Starting a second import
  while one is running used to let the second one's cleanup
  delete the first one's pieces mid-flight; the cleanup now knows
  which collections are in flight and leaves them alone.

### Answers

- **The evidence leads.** The main source's card, with its
  best-answering sentence, now sits above the answer, and each
  source keeps one colour across the card and its markers. A
  post-check compares the answer's figures against the evidence:
  a figure that contradicts its source is flagged under the
  answer with the source's own sentence quoted.
- **An emergency typed mid-generation is answered at once.** It
  used to wait, unsendable, until the running answer finished; it
  now preempts it and takes the fixed routes immediately. The
  emergency gate also hears a live emergency told as a story, not
  only as a question, and the health gate now knows medicines and
  doses, so those questions no longer fall to the model's memory.
  A question about history no longer trips the gate: asking how
  many people the 1918 flu killed is not an emergency.
- **The fixed safety text carries the guides' substance.** When
  no guide can answer, the fixed text now gives the urgency signs
  that mean call now, six universal steps, what not to do, and
  the rule for doses (age and weight, the leaflet, no aspirin
  under 16), every line traced to NIDO's own Essentials guides.
  It still invents no numbers and dials nothing by itself.
- **Blind evaluation is now an installed practice.** Sealed sets
  of questions are judged blind against frontier reference
  answers. On the third fresh set the routing reaches 24 of 24;
  the fixed text's own ceiling is recorded with the results, not
  hidden.
- **The model load plans for the phone it is on.** Instead of
  refusing when the preferred context does not fit, the load
  takes the largest context that fits, and a load that never
  confirmed itself shrinks the next attempt's budget.

### Knowledge packs

- **NIDO Local is trilingual** (knowledge-packs-v9): its 23
  country guides now exist in Portuguese too, each checked digit
  by digit against the Spanish original, and the pack's control
  questions grow to 165 (56 Spanish, 53 English, 56 Portuguese).
  Retrieval on the measured build passes 164 of 165; the one
  miss is recorded in the pack documentation.
- **Every pack build now writes an edition card beside the
  signature**: source edition, rights, languages, counts and
  record digests, so what was published can be checked against
  what was built. The builder also publishes by writing a
  temporary file and renaming it, so a failed build never
  destroys the good edition.

### Data

- **The total delete collects the whole family.** Two files the
  app could leave behind (a settings recovery marker and a
  half-written flags file) survived a total delete; the delete's
  inventory is now a census of every file the app can produce,
  and a guard test fails if a new producer is ever left out of
  it.

### Project information

- The "NIDO development" card in About (0.1.65) remains the
  project's note on voluntary contributions; NIDO is free and
  complete without contributing anything.

## 0.1.67-alpha - 2026-10-31

### The full audit

- **The whole app was audited end to end, and this version carries
  the fixes.** Code, security, data storage, the knowledge packs,
  the signed download catalogue, the test suite itself, the build
  pipelines, the public pages and all three languages were examined:
  124 findings. 88 of them are fixed in this version and proven by
  tests; the ones that remain are recorded with their cause (design
  work and verification programmes, not defects left unmentioned).
  The full automated suite passes: 4,711 tests in 300 files, plus
  the component suite.
- **The signed catalogue now signs more of every entry.** The
  maintainer signature used to cover only part of each download
  entry, so a changed licence, capability list or architecture
  profile would have passed it. It now covers 14 fields of every
  entry, and the model pin check compares fingerprints against the
  publishers' own APIs instead of only checking that a file answers.
- **An anchored guide always keeps its first section in front.**
  When an answer is anchored to one section of a guide, the guide's
  opening section now always travels with it, as the anchoring was
  designed to do.

### Data and backups

- **Backups and restores fail out loud instead of half-way.** A
  backup now consolidates both databases or reports its failure;
  restoring never overwrites the live database without a safety
  copy; an interrupted encryption key rotation is also recovered on
  a normal start; and the app now counts a backup for the hardware
  vault's 30-day rule when it leaves the phone, which is when it
  protects you. What the backup keeps is also what the app now says
  it keeps, in Spanish, English and Portuguese.
- **The total delete proves itself.** Deleting everything now
  verifies that the private prompt, the hardware key and the
  rotation staging key are really gone, and a failed import no
  longer leaves orphaned pieces behind for the next one.

### Answers

- **Two generations at once no longer share the model's memory.**
  Starting a second answer while one is running used to let them
  write into the same context; generations are now serialized.
- **Numbers and consent read correctly.** The converter no longer
  reads "1,000" as 1, an expired negotiation now answers "expired",
  consent scope labels appear in your own language, and internal
  error texts no longer reach the alert dialogs.

### Knowledge packs

- **Corrected edition of NIDO Local** (knowledge-packs-v8): the
  Portugal fact now quotes the exact phrase of its official source,
  and the pack's own control questions were rewritten so they
  measure the search honestly.

## 0.1.66-alpha - 2026-10-31

### Knowledge packs

- **Corrected editions of three guide packs** (knowledge-packs-v7):
  NIDO Local, NIDO Crisis and NIDO Road Travel. In NIDO Local, every
  fact is now backed by a reachable official source: the Argentina
  107 and Philippines 911 numbers have a new official backing, and
  three facts that cited press reports now cite the official source
  itself. In NIDO Crisis and NIDO Road Travel, the search metadata
  of two guides was fixed, so their own questions find them again.
- **A written decision on burn cooling.** The pack documentation
  now records why NIDO Essentials says to cool a burn for at least
  10 minutes and NIDO Children and Babies says 20 minutes: each
  guide follows its own cited source, and the two do not contradict
  each other.

### Fixes

- **The app no longer asks for the launcher badge permission.** It
  came from a library bundled with notifications; no part of NIDO
  uses launcher badges, and the permission is now blocked like the
  rest of that family.
- **The project's own pages tell the truth.** The README in both
  languages says the Local pack covers 69 countries and gives the
  current test count, and the alpha notes record that 0.1.64 passed
  the owner's physical round on his tablet.
- **The Android dependencies file is the list it promises.** The
  release file `android-runtime-dependencies.txt` now contains only
  the dependency tree, without the build log that came attached
  to it.

## 0.1.65-alpha — 2026-10-31

### Answers

- **An answer no longer dies when you leave the app.** Writing continues
  in the background; if the system kills the process mid-answer, the
  chat keeps a note that the answer was cut, instead of silence.
  Before, leaving the app cancelled the answer and nothing was saved.
- **Asking for a story is creation again.** "Tell me a story"
  ("cuéntame un cuento", "conte-me uma história") is understood as a
  creative request even when you have imported documents; before, a
  document about a similar topic could swallow the request and answer
  with its facts instead.
- **Emergency numbers answer in mixed languages.** Asking a country's
  emergency number with words from two languages now takes the fixed
  route and answers from the checked table; when a country is not
  covered, NIDO says how many countries the installed packs cover
  instead of guessing.
- **Guide answers open at the section you asked about.** A question
  about carbon monoxide symptoms opens the guide at its symptoms
  section, not at the first one.

### Knowledge packs

- **Seven new guide packs**, each in Spanish, English and Portuguese:
  NIDO Children and Babies, NIDO Crisis, NIDO Without Utilities, NIDO
  Safe Home, NIDO Disasters, NIDO Field and Animals and NIDO Road
  Travel.
- **NIDO Essentials is now also in Portuguese**: 174 guides, 58 per
  language.
- **NIDO Local now covers 69 countries** (155 checked numbers), and
  the Emergency tab has a crisis-lines card fed by the NIDO Crisis
  pack (verified lines for 14 countries).
- **Guides are served in the language you read them in.** Before, the
  Portuguese text of a guide could come back in Spanish; and NIDO
  Children and Babies now answers with the guide's own words, like
  NIDO Essentials does.

### Project information

- The About screen now includes the "NIDO
  development" card, with the project's public addresses for those
  who have asked how to make a voluntary contribution. NIDO remains
  free and complete without contributing anything, and a
  contribution grants no advantages and unlocks no features.

## 0.1.64-alpha — 2026-10-29

### Security
- **A hostile PDF can no longer fill the phone's memory inside the PDF
  reader.** NIDO now reads PDFs with its own module: it refuses more than
  3,000 pages and stops reading as soon as the text passes what still fits in
  the import limit, even in the middle of one huge page. Before, the library
  returned the whole text at once and NIDO could only measure it afterwards.
  It uses the same PDF engine as before (PdfBox-Android).
- **Hardware protection now asks for a recent backup first.** Turning on the
  vault requires a backup from the last 30 days: if you ever removed the
  screen lock, Android would delete the vault key and only a backup with its
  key could bring your data back. Before, the backup was only recommended.

## 0.1.63-alpha — 2026-10-29

### Security
Lessons from every public audit of Signal and Briar, matched against NIDO
([docs/DECISIONS.md](https://github.com/Nido007-cmyk/Nido/blob/main/docs/DECISIONS.md), D12).
- **Contacts are no longer shown as "verified" unless you verified them.**
  Until 0.1.62 every paired contact showed "✓ verified", although nobody
  had compared fingerprints and the pairing code can arrive over any
  channel. Now a contact is "not verified" until you compare fingerprints
  (in person or on a call) and tap **Verify**. Contacts you already had
  start as "not verified".
- **Voice dictation only uses a recognizer that runs on the phone**, by
  default (Android 12 or later, when the phone has one). If your phone only
  has the system speech service, which may send audio over the internet,
  dictation stays off unless you turn off Settings › Voice › "On-device
  recognition only".
- **The key rotation file is encrypted.** While a key rotation runs, the
  file that lets NIDO recover from a crash no longer holds the old and new
  keys in clear; it is encrypted with a key kept in the Android Keystore.
- **Pack offers have a quota:** at most 3 unaccepted offers per contact and
  10 in total; unaccepted offers are forgotten after 30 minutes.

## 0.1.62-alpha — 2026-10-29

### Security
Fixes from the owner's security audit of 2026-10-29 (no critical or high
findings; these are the medium and low ones that needed no policy decision).
- **The network log now survives restarts.** The privacy policy and the
  About screen promised a log you could check, but it was only kept until
  the app closed. It is now stored in the encrypted database (the latest 500
  entries) and erased with everything else. The policy also named the wrong place
  for it: it is in Settings › Security and privacy › Security check and
  network log.
- **A PDF that unpacks into a huge amount of text is refused before it can
  fill the phone's memory.** The text is measured right after it is read,
  before it is split into pieces, and an import of several files stops as
  soon as the total is too big.
- **A paired contact can no longer push pieces of a pack you didn't
  accept.** Nothing was ever installed without your acceptance and the
  catalog check, but the pieces were kept in memory.
- **Restoring a backup says what will happen.** The confirmation now says
  the backup's date and that anything deleted since then (chats, notes,
  documents, removed contacts) comes back; revoked contacts stay revoked.
  Restoring with the backup key now asks for that confirmation too. A backup
  made by a newer NIDO format is refused instead of being read as an old
  one.
- **The backup checksum is now the real SHA-256 of the file.** Before, the
  value only detected corruption; it didn't match `sha256sum`. Older backups
  are still accepted.
- **The backup file size limit (100 MB) is also checked when a portable
  backup is unpacked.**
- **15 launcher badge permissions are removed from the APK.** A library
  brings them for icon badges, which NIDO doesn't use.
- **The Spanish privacy policy** now lists the on-device telemetry and the
  optional list of unrecognized commands, as the English one did.

### Decided
- The hardware vault stays an offer, "Private hello only" stays off by
  default, and three known limits are stated (short pastes, voice dictation,
  the key rotation staging file), with what would change each one
  ([docs/DECISIONS.md](https://github.com/Nido007-cmyk/Nido/blob/main/docs/DECISIONS.md), D9–D11).

## 0.1.61-alpha — 2026-10-29

### Changed
- **The second question of a new chat starts answering sooner.** NIDO used
  to ask the model for a chat title right after the first answer; that
  erased the model's cached instructions, so the next question had to read
  about 285 tokens again (about 36% of its prompt). The title now comes from
  your first question, with no model and no battery spent. The model's
  instructions are also ordered so the part that never changes stays cached
  between questions with and without sources. Measured on NIDO's default
  model ([docs/perf/PROMPT_CACHE_2026-10-29.md](https://github.com/Nido007-cmyk/Nido/blob/main/docs/perf/PROMPT_CACHE_2026-10-29.md)).

### Added
- **Where each sentence comes from.** Under an answer's sources, a line now
  says how many sentences come from the guide, from the sources, from a
  fixed NIDO text, where NIDO says it doesn't know, and how many come from
  the model with no source. A sentence the sources don't back is never
  counted as coming from them.

## 0.1.60-alpha — 2026-10-29

### Added
- **NIDO's constitution.** A document that says how the assistant should
  behave and why: what wins when being helpful, honest, safe and private
  conflict, eight firm rules (first aid shown as written, emergency numbers
  never guessed, confirmation before any action outside the app, pasted or
  document text never taken as a command…) and how each one is checked.
  CI now fails if a rule loses its check
  ([docs/NIDO_CONSTITUTION.md](https://github.com/Nido007-cmyk/Nido/blob/main/docs/NIDO_CONSTITUTION.md)).
- **A bigger evaluation, checked on every change.** 118 test questions in
  English, Spanish and Portuguese (first aid, emergency numbers, carbon
  monoxide, tools, honesty, attacks); 47 run against the real code on every
  change, and every first aid question has to find the right guide
  ([docs/eval/EVAL_V2.md](https://github.com/Nido007-cmyk/Nido/blob/main/docs/eval/EVAL_V2.md)). Its first run found the
  three problems fixed below.
- **Confirmation before actions, now proven tool by tool.** A test checks
  that every tool with an effect outside the app asks you first, and that
  text from a document, pack or note can't trigger an action without your
  confirmation.
- **A record of product decisions** ([docs/DECISIONS.md](https://github.com/Nido007-cmyk/Nido/blob/main/docs/DECISIONS.md)):
  messages only between people paired in person, no relay server, first aid
  never rewritten, the daily summary opt-in, and the plan for Android's
  developer verification, an external audit and F-Droid, each with its
  reason and what would make us revisit it.
- **Short version of a first aid guide, still in its own words.** Asking
  "summarize the CPR guide" or "resúmeme la guía de quemaduras" shows the
  start of that guide exactly as written, up to its first numbered steps,
  says that the full guide is the reference and offers to open it. No AI
  model rewrites a first aid guide, even when you ask for it shorter.

### Changed
- **The 8:00 daily summary is now optional, and off unless you turn it on.**
  Before, NIDO scheduled it on its own as soon as notifications were
  allowed. Turn it on in Settings › What I remember › Daily summary.
  NIDO's constitution says its notifications are the ones you ask for.

### Fixed
- **The daily summary was always in Spanish.** It now uses the app's
  language (English, Spanish or Portuguese).
- **Older versions of NIDO keep downloading their packs.** A new version of
  a knowledge pack now always goes to a new release instead of replacing the
  old file, and an automated check stops the catalog from pointing an
  existing address at different bytes. (Replacing NIDO Local's file for
  0.1.58 left 0.1.57 unable to download it.)
- **The README had the Wikipedia pack's size wrong.** It has about 50,000
  articles (49,832); the 116,000 it said was the number of search passages.
- **Carbon monoxide warning with gas heaters, furnaces and fireplaces.** If
  you mention one of them together with symptoms ("the gas heater is on and
  we all have a headache"), NIDO now gives the carbon monoxide warning: get
  everyone outside and call for help. Asking whether you can use them indoors,
  with no symptoms, still gets no "never use it inside" warning, because they
  are made for indoor use. "Nos duele la cabeza" now counts as a symptom too.
- **"Send Ana a NIDO message saying that…" in more words.** "Mándale un
  mensaje NIDO a Ana…" and "…un mensaje de nido a Ana…" are understood, and
  "…diciendo que llego tarde" no longer sends "que llego tarde" with an
  extra "que" (same for "saying that" and "dizendo que").

## 0.1.59-alpha — 2026-10-28

### Fixed
- **First aid answers now show the guide exactly as written.** When a
  NIDO Essentials guide is the clear best match for a question (CPR,
  choking, burns, bleeding…), NIDO shows that guide's own text, with its
  sources and an "Open the full guide" button, and no AI model rewrites it.
  On a real tablet the model's summary of the chest-pain guide dropped a
  "not" in the aspirin rule ("is bleeding" instead of "is not bleeding"),
  and the choking answer told you to keep the person at your side and
  watch. These answers are also instant: no model has to run.
- **Model answers can't flip a "not" from the sources.** If a sentence in a
  model answer copies a source sentence but loses or adds a negation ("no",
  "never", "without", "not"…), it is replaced by the source sentence word
  for word. A first aid step containing "no se lo ha prohibido" was also
  being read as "I don't know"; that is fixed.
- **The CPR question finds the CPR guide.** Question words like "how do I"
  ("cómo hago", "o que faço") no longer count as topic words, and long
  words also match their plural and longer forms ("adulto" finds
  "adultos", "atraganta" finds "atragantamiento").
- **A clearer message when the server has another version of a pack.** If
  the file on the server is bigger than this version of NIDO expects, the
  app no longer calls it "incomplete": it says it's a different version,
  that nothing was installed, and that updating NIDO fixes it. Seen when a
  phone on 0.1.57 tried to download the newer NIDO Local made for 0.1.58.

## 0.1.58-alpha — 2026-10-28

### Added
- **NIDO Local: the emergency numbers table grows to 32 countries.** Nine
  countries join the pack's checked facts table: Equatorial Guinea,
  Andorra, the Philippines, France, Italy, Germany, the United Kingdom,
  Canada and Australia. Every number keeps its official source, the exact
  quote and the date it was checked. The new countries have no guides yet:
  for them, NIDO answers from the verified table only. Japan stays out on
  purpose, so it remains the example of a country NIDO has not checked and
  will not guess. The rebuilt pack ships in knowledge-packs-v5 and its
  catalog entry is re-signed.

## 0.1.57-alpha — 2026-10-28

### Fixed
- **A pack is no longer deleted just because a newer version exists.** When
  an app update brought a new version of an installed pack (for example NIDO
  Local), the old one was deleted on the next check so it could be
  downloaded again — offline, that left the phone without the emergency
  numbers it had. Now the pack you have keeps working, offline too, and is
  shown as **Update available**. Answers with emergency numbers from it say
  they come from an older version of the pack, next to the date each source
  was checked. The new version replaces it only after it has finished
  downloading and been verified. A pack file that was modified is still
  deleted, as before.
- **The "which country?" answer lists every country with checked numbers.**
  When you ask for an emergency number without a country, or for a country
  NIDO has no checked number for, it still doesn't guess; the list of
  countries it does have now includes all the ones in your installed packs
  (23 with NIDO Local) instead of only the 8 built into the app.

## 0.1.56-alpha — 2026-10-28

### Added
- **Share a knowledge pack with a contact, without internet.** A NIDO can
  now pass a catalog pack (for example NIDO Essentials, about 0.7 MB) to a
  connected contact over Bluetooth or local Wi-Fi, from the Packs tab. The
  receiver installs it only if it is byte-for-byte the file in NIDO's
  signed catalog; anything else — a hand-made pack, a modified one — is not
  offered and not installed. The previous pack stays in place if anything
  fails. The transfer code existed since 0.1.4 but was never connected, and
  the Packs tab (NIDO › Packs) was hidden; it is visible again.
- **Read the whole guide behind an answer.** Under an answer's sources, a
  knowledge-pack source now has "Read the whole guide": it opens the full
  guide, offline, with the part NIDO used highlighted and the original
  source it was written from. Anyone can check where an answer comes from.
  Idea from BOAR (MIT).

### Changed
- **Every release checks its own reproducibility.** After publishing, the
  release workflow starts the reproducible-build check against the APK it
  just published (two independent builds of the same commit, compared file
  by file, signature aside). Before, it had to be started by hand.
- **Android libraries in the licenses.** Each release now carries
  `android-runtime-dependencies.txt`, the exact list of Android libraries
  (AndroidX, Kotlin, SQLCipher and what they pull in) compiled into that
  APK. THIRD_PARTY_NOTICES now also lists the native ML-KEM code vendored in
  the repository (mlkem-native 2.0.0, Apache-2.0 OR ISC OR MIT) with its
  license text. The license texts of the Android libraries are not
  reproduced yet.

### Fixed
- **Navigation in the new interface** (found auditing the 0.1.55 APK):
  "Try it" in the guide opened from the Library or Settings now shows the
  chat where the example was typed; "Share → NIDO" and the new-chat
  shortcut show the chat even if another tab was open; Android's Back
  button closes the open menu or screen and returns to Chat instead of
  leaving the app; "My documents" in the side menu opens the Library on My
  documents.
- **Release notes on GitHub** no longer repeat the whole notes file (with
  the 0.1.1–0.1.18 history before the new changes and the limitations
  twice).
- **"The emergency number that's used here"** is no longer taken as a
  question about the United States ("usa" is also a Spanish verb).
- **Pack sharing no longer reports "complete" for a pack it did not
  save** (when no installer was connected, the receiver said "complete").
- **Choose the contact** when several are connected, instead of sending to
  the first one in the list; only connected contacts are offered.
- **An answer is no longer lost when you leave the app.** While the AI
  writes an answer, NIDO now shows a quiet "NIDO is answering…"
  notification (an Android foreground service). Some phones closed NIDO a
  few seconds after you switched apps, and the answer stopped half-way. It
  starts with each visible answer and stops when it ends; no sound, no
  pop-up; it stops by itself after 15 minutes if nothing stops it. Idea
  seen in BOAR; NIDO's own implementation. Needs the check on the
  tablets (start an answer, switch apps, come back) before release.

### Security
- **Private hello: no identity in clear with contacts that support it.**
  Automatic Bluetooth reconnection called the contact without naming it and
  sent the old hello with the permanent identity in clear; it now seals like
  a manual call. If the contact's private-hello mark cannot be read, NIDO no
  longer falls back to the plain hello: it does not call and says why.
- **New setting "Private hello only"** (Settings → Security, off by
  default): this phone never states its identity in clear — it does not
  call contacts on NIDO older than 0.1.49 or devices that are not contacts,
  and it does not answer plain hellos. The contacts list now marks contacts
  whose private hello is not confirmed yet. Off by default because it cuts
  off contacts who have not updated. Tested in CI only; needs the two-phone
  check before release.
- **Local Wi-Fi server on the Wi-Fi interface only.** While searching for
  contacts, the Wi-Fi server used to listen on every network interface
  (filtered by private address and subnet). It now listens only on the
  Wi-Fi network the phone is on, or on the hotspot it is sharing, so it does
  not exist on the mobile-data interface. With unusual interface names it
  falls back to the previous behaviour. Needs the two-phone check (same
  Wi-Fi, one phone as hotspot, Wi-Fi change mid-search) before release.

### Safety
- **Fixed answers where a mistake could kill.** Two kinds of question are
  now answered by NIDO's own checked text, never by the AI model:
  - Running a generator, grill, brazier, charcoal or a running car inside a
    home, garage, basement or tent: "No", even with doors and windows open,
    20 feet / 6 m from the house, CO alarms, and what to do if the alarm
    sounds or someone feels sick (US CPSC and CDC). A small model can answer
    "yes, with ventilation". Idea from BOAR's Cohazard; text and rules are
    NIDO's.
  - "What's the emergency number in…": only countries checked against an
    official source (United States, Puerto Rico, Mexico, Dominican Republic,
    Cuba, Spain, Portugal, Brazil), each with its source. With the NIDO
    Local pack installed, its 23 checked countries answer first. Any other
    country: NIDO says it has not checked it and does not guess.
  In Spanish, English and Portuguese. Questions that merely mention these
  things (cleaning the kitchen grill, a car parked in the garage) are not
  caught.

## 0.1.55-alpha — 2026-10-28

### Added
- **New interface.** A bottom bar puts the five main sections one tap away:
  Chat, Emergency, Library, NIDO and Settings.
  - **Emergency** (new) shows your country's checked emergency numbers with
    their source and date. "Call" opens the phone's dialer with the number
    typed in. "Describe what's happening" and quick guides (CPR, bleeding,
    choking, burns, earthquake, hurricane) write the question into the chat.
  - **Library** (new) gathers the knowledge packs (download, remove,
    multilingual search), your documents, the guide and prompt ideas. The
    packs are still in Settings too.
  - **Settings** is grouped into nine sections (security, assistant, models,
    memory, appearance, backup, diagnostics, help, danger zone) and has a
    search box. The security check, network log, crash diagnostics, agent
    permissions and activity, skills and scheduled tasks moved there from
    About. Settings also opens My memory, the execution telemetry, About and
    the backup key screen.
  - **Chat:** tone and deep research are chips next to the input. Deep
    research can now be switched on from the chat too. An emergency-number
    answer comes with "Call" buttons; they open the dialer.
  - **Chat history** has a search box.
  - **Wipe button:** now a red shield labelled "Wipe" instead of "SOS", so it
    isn't mistaken for asking for help.
  - **No control was removed.** Every button is still there, in its new place.
- **NIDO Local knowledge pack: 23 countries.** Guides by country, in
  Spanish and English, with the emergency numbers checked against an
  official source: Cuba, Dominican Republic, Puerto Rico, Mexico, Guatemala,
  Honduras, El Salvador, Nicaragua, Costa Rica, Panama, Colombia, Venezuela,
  Ecuador, Peru, Bolivia, Chile, Argentina, Uruguay, Paraguay, Spain,
  Portugal, Brazil and the United States. Where we could check it, also who
  issues warnings and what each official alert means (Cuba's cyclone phases,
  the COE alerts, NWS watches and warnings, Mexico's hurricane colors and
  earthquake alert, Chile's SAE, Spain's ES-Alert, Brazil's Civil Defense
  SMS, US Wireless Emergency Alerts). Optional download; it can also be
  passed phone to phone. Built in knowledge-packs-v5; the catalog entry
  needs the maintainer's signature.
- **Emergency numbers answered from verified facts.** Ask "what number do I
  call for an ambulance in Chile?" and, with NIDO Local installed, the answer
  comes straight from the pack's facts table: the number you asked for first,
  the others after, and the official source with the date it was checked. No
  search ranking and no model in between, so it can't be made up.
- **Weekly source check.** Every number in the packs is stored with the exact
  quote from its official page; a weekly check reopens each page and flags
  any quote that is gone, so a changed number is caught before the next
  release.

## 0.1.54-alpha — 2026-10-23

### Fixed
- **NIDO Esencial knowledge pack v4 — fact-checked guides.** Five guides
  were corrected against the current official guidelines (AHA and
  American Red Cross 2024, ERC 2021, WHO), in Spanish and English:
  12 severe allergy / anaphylaxis (a second adrenaline dose after
  5–10 minutes, only if help has not arrived), 14 chest pain / heart
  attack (chewable aspirin 162–325 mg), 20 drowning (ERC 2021 added to
  the sources), 22 bites and stings (the jellyfish vinegar advice was
  removed: it depends on the species and can worsen some stings),
  and 23 nose, eyes, teeth and ears (nosebleed: 15 minutes of
  continuous pressure; knocked-out tooth: rinse under 10 seconds).
  The signed catalog now pins the knowledge-packs-v4 release (PRs #136
  and #137); the v3 files stay published and pinned for 0.1.53. As
  before: no medical body has reviewed the pack and the Red Cross
  does not endorse it.

## 0.1.53-alpha — 2026-10-22

### Added
- **NIDO Esencial knowledge pack.** 116 offline guides (58 in Spanish and the
  same 58 in English) on first aid, health at home, disasters and survival,
  written by NIDO from public guidance: the IFRC and the American, Canadian
  and Spanish Red Cross societies, the AHA 2025 CPR guidelines, WHO, UNICEF,
  CDC, FEMA, NOAA and USGS. Offered in the Standard, Full and Encyclopedia
  installs, with a multilingual-search variant. The signed download catalog
  (signed in the pull request that added the pack) points at the
  knowledge-packs-v3 release, whose files match the catalog pins byte for
  byte. Every guide states that it does not replace a course and that
  emergency services come first; no medical body has reviewed the pack and
  the Red Cross does not endorse it.

## 0.1.52-alpha — 2026-10-22

Fixes from an independent security review of the code added in 0.1.48–0.1.51,
done by a reviewer that had not seen the code being written.

### Security
- **The handshake flaw that 0.1.48 fixed is now also caught on the first
  connection with a contact paired before 0.1.49.** That flaw is the
  "unknown key share", where a malicious contact makes two phones share a
  session while each one believes it is talking to someone else.
  - In that case, a message that is genuine for the session but addressed
    to another person used to be dropped silently, which left a session
    that went nowhere.
  - Now the phone recognises it, drops the connection and from then on
    requires that contact's signed confirmation, so the trick cannot be
    repeated.
  - Messages could never be read or forged, because they always carried
    sender and recipient inside the encryption.
  - **Correction:** the 0.1.48 notes said the first connection was already
    covered; for this case it was not, until now.
- **The private hello can no longer be switched off by an attacker.**
  Whether a contact supports it was also learned from an unsigned hint in
  its hello. Someone in between could remove that hint, and this phone would
  go back to calling that contact with its identity in clear. Now that
  knowledge is only ever added, never removed.
- The key that encrypts the first headers of a connection is erased as soon
  as it is no longer needed.

### Tests
- **Two complete NIDO phones end to end:** pair by QR code, connect,
  private hello, signed confirmation, new key per message with encrypted
  headers, and chat in both directions. The test also checks that no byte
  on the wire contains either phone's identity.

## 0.1.51-alpha — 2026-10-22

### Security
- **ML-KEM-768 now runs natively, with formally verified code.** The
  quantum-resistant part of NIDO-to-NIDO connections now uses mlkem-native
  v2.0.0, the implementation used by AWS-LC and Open Quantum Safe (libOQS):
  - its C code is proven memory-safe with CBMC;
  - its assembly for arm64 phones is proven correct and constant-time with
    HOL-Light.

  Before, it used a JavaScript library without an independent audit and
  without constant-time guarantees, which now stays only as a fallback.
- **Checked twice that nothing breaks:**
  - CI compiles the exact code shipped in the APK, on x86 and on arm64, and
    checks that it gives exactly the same bytes as before in 300 tests.
  - The phone repeats that check once before using it, and keeps the
    JavaScript version if anything differs.

  Phones with older NIDO versions keep working with this one.
- **The hardware vault is offered on the main screen.** Before, it was only
  in Settings → Security. It explains what happens if you ever remove the
  screen lock, asks you to confirm and turns it on with your fingerprint or
  PIN. It is not turned on by itself, because it needs a screen lock and
  that is your choice. "Not now" hides it for a week.
- **Checked against the public audits of other messengers.** The findings
  published against Threema (ETH Zürich), Signal's PQXDH, Briar (Cure53)
  and Matrix were compared one by one with NIDO's code
  ([`docs/security/LESSONS_FROM_PUBLIC_AUDITS.md`](docs/security/LESSONS_FROM_PUBLIC_AUDITS.md)).
  Two things were changed as a result:
  - On Android 11 and older, NIDO now ignores taps while another app draws
    over it, as Briar did after its audit. Android 12 and later already hid
    those overlays. Side effect: with a screen-filter app on, NIDO does not
    respond to taps until the filter is turned off.
  - The system log no longer records the Bluetooth or Wi-Fi address of the
    phones NIDO connects to.
- **Scope for a professional security audit:**
  [`docs/security/AUDIT_SCOPE.md`](docs/security/AUDIT_SCOPE.md) lists what
  to review, what has already been checked and how, and the weaknesses we
  know of.

## 0.1.50-alpha — 2026-10-22

### Security
- **Encrypted headers in NIDO-to-NIDO messages.** Each message already had
  its own key. Its header still travelled in the clear: the per-message
  ratchet key, the message counters and, in the first messages, the ML-KEM
  ciphertext. Someone recording nearby could count messages and follow
  turns. Now the whole message, header included, goes inside a second
  encrypted box.
  - Signal does not encrypt these headers.
  - The box key comes from the session root, which also mixes in ML-KEM,
    so a future quantum computer cannot read those headers either. The
    only exception is the first messages, before the other phone has that
    root.
  - Used when both phones have 0.1.50 or later. With an older NIDO,
    messages go as in 0.1.49.
  - Once a connection uses encrypted headers, a message without the box is
    rejected, so nobody can force a fall back.

## 0.1.49-alpha — 2026-10-22

### Security
- **The strongest NIDO-to-NIDO protections are now on by default.** Before,
  you had to turn them on in Settings:
  - **Private hello:** the first messages of a connection are sealed, so
    nobody nearby can see who is calling.
  - **A new key for every message** (Double Ratchet) and **ML-KEM-768** in
    every connection, against future quantum computers.

  They are used when the other phone supports them. With an older NIDO,
  the connection uses what that phone supports, as before. They can still
  be turned off in Settings.
- **Protected from the very first connection.** The pairing QR code now says
  what your NIDO supports. A new contact uses the private hello and the
  signed confirmation from 0.1.48 from the first connection, instead of
  learning it during that connection, which was the one an attacker could
  try to downgrade. An older NIDO reads the QR code as always.

## 0.1.48-alpha — 2026-10-22

### Security
- **Closed a weakness that formal verification found in the NIDO-to-NIDO
  handshake.** The protocol is now checked with ProVerif, a research tool
  that proves security properties against an attacker who controls the
  whole network. It found an "unknown key share": the signatures in the
  handshake did not say *who they were meant for*, so a malicious contact
  could make one phone accept a connection "with B" that B believed it was
  having with someone else. It could not read or forge messages (every
  message names sender and recipient inside the encryption, and that is
  checked), but it was a real flaw in the handshake.
- The handshake confirmation now carries a second signature that also names
  the recipient. A confirmation made for someone else is rejected.
  - Once a contact has used it, it is always required. If someone strips it
    off, even on the very first connection, the phone notices inside the
    encrypted session, drops the connection and keeps requiring it.
  - Phones with an older NIDO still connect as before. The fix applies as
    soon as both phones have 0.1.48.
  - The formal model with the fix (`formal/nido_handshake_v2.pv`) proves
    that both sides agree on who they are talking to.
- Formal verification of the protocol runs in CI on every protocol change
  (`formal/`, see `formal/README.md`). It proves that messages stay secret
  and authentic, also against a malicious contact, and that what is sent
  with the post-quantum mode stays secret even if X25519 is broken later.

## 0.1.47-alpha — 2026-10-22

Fixes from a full audit of NIDO.

### Fixed
- **"Erase all data" and the panic button now really erase everything.**
  Before, these stayed on the phone: local backups made from Settings (all
  your chats, encrypted with the key you were shown), the copy NIDO keeps
  when restoring a backup, the list of revoked contacts, and the settings
  file that showed, for example, that the panic button was on. Now they are
  deleted too, and the erase fails loudly if any of them survives.
- **Disappearing messages no longer survive in backups.** A backup now
  leaves them out (as Signal does), and the copy kept after restoring a
  backup is deleted the next time NIDO opens normally.
- **You get a notice when a NIDO message arrives** with the app in the
  background. It says only "New NIDO message": not who wrote it, not what
  they wrote, and it is hidden on the lock screen. The privacy policy
  already promised message notifications; they did not exist.

### Security
- **Local Wi-Fi: at most 2 connections from the same device**, and a
  device that connects has 20 seconds to say hello. Before, one device on
  your network could fill all 8 connection slots and keep your contacts
  out.
- The NIDO chat no longer writes to the database every 4 seconds while it
  is open; it only does so when a disappearing message starts its timer.
- The old Bluetooth permissions are limited to Android 11 and earlier, as
  Android recommends.
- Every build now lists the final Android permissions and the parts of
  the app other apps can open, so they can be reviewed on each release.
  The first list showed things libraries added that NIDO never uses, now
  removed: the Firebase push-notification receiver and its permission,
  "display over other apps", Google Play's install referrer and permission
  to edit your contacts (NIDO only reads them, when you ask).
- **Reproducible builds:** found why two builds of the same code sometimes
  differed: React Native stored the IP address of the machine that built
  the app inside it (for its development server, unused in the released
  app). It is now fixed to the same value on every machine. Two independent
  builds of this release now match in all 1,554 files (signature excluded).

## 0.1.46-alpha — 2026-10-22

This release brings over the security features of Signal and Briar that
NIDO did not have yet. The new connection protocol is off by default until
it is tested on two phones.

### Added
- **New key for every message, and quantum-resistant connections
  (experimental, off by default)**: Settings → Security. When both phones
  have it on, every message is encrypted with its own key that is erased
  after use (the Double Ratchet design used by Signal): a key stolen from
  memory does not open earlier messages, and the conversation heals on its
  own after the next reply. Each connection also mixes in ML-KEM-768
  (FIPS 203) with the existing X25519 key, so traffic recorded today stays
  closed even to a future quantum computer. If one phone has it off or runs
  an older NIDO, the connection works exactly as before.
- **Disappearing messages**: in a NIDO-to-NIDO chat, tap the timer next to
  the contact's name (5 minutes to 4 weeks). New messages delete themselves
  on both phones: for the sender the time counts from sending, for the
  receiver from when they see it, like Signal. Either side can change it;
  the other phone takes the newest setting with the next message.
- **Panic button (off by default)**: Settings → Security → Panic button.
  It puts an SOS button on the main screen; holding it for 3 seconds erases
  all NIDO data at once, without asking for a fingerprint. Turning it on
  asks for your fingerprint or PIN.
- **Incognito keyboard**: every text field in NIDO asks the keyboard not
  to learn from what you type (no new words in its dictionary, no
  suggestions based on your chats), like Signal's incognito keyboard. Major
  keyboards respect this; NIDO cannot force one that ignores it.

### Security
- **Message padding**: NIDO-to-NIDO messages are padded to fixed sizes, so
  their length no longer gives away the length of what you wrote. Older
  versions of NIDO read padded messages normally.
- **Deleted messages are overwritten** inside the encrypted database
  instead of being left in free space.
- **Fuzzing**: everything that reads data from another phone or a QR code
  is now tested with mutated and random inputs on every change, and with
  100,000 cases per target every week. Writing these checks turned up
  three handshake parsers that failed with a raw error on inputs like
  `null`; they now reject them cleanly.
- **Towards reproducible builds**: a new check builds the APK twice on
  separate machines and compares them file by file (and, on request, against
  the published APK); `scripts/compare-apk.py` lets anyone do the same. The
  first run found 1,553 of 1,554 files identical; the compiled resource table
  (`resources.arsc`) still differs, so the build is **not reproducible yet**.

## 0.1.45-alpha — 2026-10-21

### Fixed
- **Over Bluetooth, the phone that receives a connection no longer
  reveals who it is to strangers.** It now stays silent until the caller
  proves to be one of your paired contacts, as it already did over local
  Wi-Fi. Before, any nearby device that connected to NIDO's Bluetooth
  service received your NIDO identity, signed. Our earlier notes said this
  was already fixed for Bluetooth; it was not, and the privacy policy in
  0.1.44 repeated that mistake. Phones on older versions still connect.

### Added
- **Private hello (experimental, off by default)**: Settings → Security →
  Private hello. When on, and the contact you call also has
  0.1.45 or later, the first messages of the connection are sealed, so
  nobody nearby can see who is calling or link two of your connections.
  Turn it on in both phones to test it; if connecting fails, turn it off.

### Security
- **Delegated tasks are bound to the live connection.** A task permission
  issued to a contact now only works in the same encrypted session it was
  sent in; a copied permission cannot be reused later. (Our docs already
  said this; the code did not do it.) Both phones need 0.1.45.
- **Bluetooth: at most 8 connections at once, and nothing large before the
  hello.** Before, nearby devices could open unlimited connections or send
  big frames before proving who they are.
- **Local Wi-Fi only accepts phones on the same network.** Some mobile
  carriers give their customers private addresses; another customer of the
  same carrier could reach NIDO's Wi-Fi route over mobile data while you
  were searching for contacts.
- **The security check in About shows whether hardware protection is on**
  and how to turn it on.

## 0.1.44-alpha — 2026-10-21

A security and privacy hardening release. Nothing about how NIDO-to-NIDO
connections work changed.

### Added
- **Protection against fake overlays (tapjacking).** On Android 12 and
  later, other apps can no longer draw on top of NIDO while it is on
  screen, so nobody can place a fake button over a confirmation.

### Changed
- **Erasing all data asks for your fingerprint or PIN**, like viewing the
  backup key or restoring already did. If you cancel, nothing is erased.
- **Your custom system prompt is stored encrypted** in the phone's secure
  storage instead of the plain settings file. An existing prompt moves
  there automatically the first time it is read.
- **The pairing code is copied as private**: on Android 13 and later it no
  longer shows in the clipboard preview or the keyboard's clipboard
  history.
- **The privacy policy now describes the local Wi-Fi route** (what is
  announced on the network and who can see it) and says plainly what is
  not hidden yet: the phone that starts a connection sends its public key
  in clear.

### Behind the scenes
- Every GitHub Action used to build NIDO is pinned to an exact commit.
- The dependency audit runs every week and on every change to `main`.
- Each release includes a list of its components (SBOM, CycloneDX).
- The security checklist (`docs/security/MASVS_CHECKLIST.md`) is up to
  date with this version.

## 0.1.43-alpha — 2026-10-16

This release watches the router itself. Every route a message can take
is now inventoried in the code, and the test suite fails if a route is
ever left unclassified. The phrase sweep grew from 5,871 to 6,550
generated phrases, with five more families measured — contacts,
calendar, managing reminders, deleting notes and the weekly plan, in
Spanish, English and Portuguese. Measuring them found three real bugs,
fixed below; after the fixes those families pass in full, and 120
phrases that almost sound like commands (but are conversation) now
correctly stay conversation. Ten routes still have no measured family;
they are listed in the code as pending, on purpose.

### Fixed
- **Sentences that mention a phone or a number are no longer treated
  as a contact search.** "The phone in my house stopped working", "I
  lost Juan's number" or «o telefone de casa não funciona mais» opened
  the contact search with the whole sentence as the name. Bare forms
  like "Ana's number" now only search when what follows really looks
  like a name; real searches ("what's Ana's number", «teléfono de mi
  mamá») work as before.
- **Portuguese text messages**: «envia uma mensagem de texto para a
  Ana» (with the feminine article) fell through to the AI model; it is
  handled directly now, like the masculine form already was.
- **Portuguese calendar events without a title**: «cria um evento
  amanhã» was discarded because the event had no title; it now gets
  the generic title («Evento») instead of being dropped. Questions
  disguised as events («agenda de hoy») still add nothing.

### Added
- **Dropped commands are counted on the device.** When NIDO prepares a
  command as a tappable chip and the chip is dropped without running —
  the text was edited, the language or mode changed, a new chat was
  started, another chat was opened, it was dismissed, or the tap came
  too late — Telemetry now shows "Dropped chips: N" with the count per
  reason. Only the reason is stored, never the text, and dropped chips
  do not count as messages in the router's numbers.

## 0.1.42-alpha — 2026-10-15

The router (the part that handles commands on the phone without the AI
model) was tested against 5,871 generated phrases: each of the usual
commands written the way people type them, with a filler word in front
("hey,", "by the way,", "please"), double spaces, a space before the
question mark, no accents, capitals, or a final period. Before this
release about a third of those still went to the AI model or were taken
for conversation; now nearly all of them are handled directly. The phrases
are generated, so these numbers are not what real use looks like; the log
of missed phrases on the device stays the real measure.

### Fixed
- **Filler words and extra spaces no longer break commands.** "Hey,
  remind me…", "by the way, my favourite colour is…", "please, what is
  2+2" or "set a timer  for 5 minutes ?" now work the same as without them,
  in Spanish, English and Portuguese.
- **More reminder and timer forms**: "can you remind me…", "add a
  reminder…", "set a timer for half an hour", "count 5 minutes", and
  Portuguese «timer».
- **"7 squared", "3 cubed"** are calculated on the phone.
- **More ways of telling NIDO something to remember**: "just so you know…",
  "for the record…", "I want you to remember…", "save in your memory
  that…" (no longer saved as a note), and facts such as "I have 2 kids" or
  "I'm married".
- **Questions about something you saved** are answered from your memory
  even when they are not in the first person ("where is the wifi
  password?" when you saved "the wifi password is on the fridge"), and
  "where did I leave the car?" works with the past tense.

### Added
- The phrase sweep is kept in the repository as a test
  (`src/eval/routerSweep.pure.test.ts`): it fails if a later change makes
  any family of commands drop below its current level, or if ordinary
  conversation ever triggers an action.

## 0.1.41-alpha — 2026-10-14

Fixes found by testing on a real tablet with the new "phrases the router
missed" log: every item below was a phrase that went wrong on the device.

### Fixed
- **Corrections to your memory are no longer lost.** If NIDO had "my
  birthday is May 5" saved and you said "my birthday is May 3", it kept the
  old date because the two sentences looked alike. Now the latest thing you
  say wins; repeating a fact with more detail still keeps the detailed one.
- **More ways of asking NIDO to remember things are understood without the
  AI model** (faster, and they no longer fail): "keep in mind that…",
  "from now on…" (saved as a preference; it used to answer with the time),
  "don't let me forget that…", and facts about your diet and allergies such
  as "I'm vegetarian" or "I'm allergic to peanuts", also with "by the way"
  in front. In Spanish and Portuguese as well.
- **Reminders asked as a question** ("on Friday at 6 can you remind me to
  call my aunt?") now create the reminder. A reminder title no longer keeps
  a stray leading "que" in Spanish.
- **"What day is December 25?"** is answered with the weekday, calculated
  on the phone, in Spanish, English and Portuguese.
- **Unit conversions with a typo** ("grades" for "grados") are no longer
  sent to the AI model, which could get the direction wrong.
- **"What do you know about me ?"** with a space before the question mark
  now lists what you told NIDO instead of going to the knowledge base.
- **Answers that cite sources no longer show the model looping** ("the
  trend of the generalization of the trend of…"): the repeated text is cut
  there too.

### Changed
- The "phrases the router missed" log (Execution Telemetry, off by default)
  now also keeps messages that look like a command but that NIDO took for
  conversation, which were invisible before. Its switch is easier to see
  and shows whether it is on.

## 0.1.40-alpha — 2026-10-14

### Added
- **About → Licenses.** NIDO now shows, inside the app, the licenses that
  apply to it: its own MIT license (with the notice of BOAR, the project it
  started from), the license of every AI model and knowledge pack you can
  download (with the conditions that matter, such as the LFM2.5 license's
  limit on commercial use), the credit and CC BY-SA 4.0 license of the
  Wikipedia text that comes inside the app, and the full license text of
  each open-source package the app is built with.

### Changed
- The license documents in the repository were reviewed and brought up to
  date: a refreshed model license audit (Qwen3-0.6B and the multilingual
  search model included), a new `THIRD_PARTY_NOTICES.md`, and corrections
  in `ATTRIBUTION.md` (the MIT license asks to keep the copyright notice; a
  visible credit is appreciated but not required).

## 0.1.39-alpha — 2026-10-14

### Added
- **NIDO now measures what its command router misses.** When a message
  that looks like a command ("remind me…", "save…", "convert…") is not
  recognized by NIDO's built-in router, it goes to the AI model instead.
  Until now a miss like that looked like a model mistake. The Execution
  Telemetry screen (menu) now shows, for the commands you
  send: how many were handled by the router, how many reached the model,
  how many times the model had to ask for a tool the router should have
  caught (and which tools), and how many needed a retry. Only counts and
  tool names are kept, never the text of your messages.
- **Optional: keep the phrases the router missed.** Off by default. If you
  turn it on in the same screen, NIDO keeps on your phone (encrypted) the
  last 50 commands that the model had to handle, so you can see which ones
  the router is missing, copy them and report them. They never leave the
  phone, and turning the option off deletes them.

### Fixed
- When the model failed to save something to memory ("I couldn't save
  that"), the measurement counted it as a model answer instead of as "not
  understood". It is now counted correctly.

## 0.1.38-alpha — 2026-10-14

### Changed
- **Pasted and shared text is never treated as a command.** Text you paste
  into the chat or share to NIDO from another app is treated as quoted
  content: if it says "remind me…" or "delete my notes", NIDO reads it but
  does not act on it. Before, sharing a text and tapping send ran it as if
  you had typed it. What you type, dictate with the chat microphone or pick
  from NIDO's own examples still works as a command.
- **One message, one action — and you tap to run it when there's more.** If
  a message has a command plus something else ("remind me to buy bread
  tomorrow and then write a poem"), NIDO no longer guesses: it shows the
  command as a button above the text box, and nothing runs until you tap
  it. The rest stays in the box as a draft to send separately. With two
  commands, only the first is prepared; the second stays in the draft. The
  button disappears if you edit the text, change the language or switch
  modes.
- A message that is just one command ("remind me to buy bread tomorrow at
  9", "set a 5 minute timer") still runs right away, as before. All of
  NIDO's examples keep working exactly the same.

## 0.1.37-alpha — 2026-10-14

An independent audit of everything added to the assistant since 0.1.19.
Nothing from outside (another NIDO, a document, a note, a knowledge pack) can
take control; these are the behaviour bugs it found, all fixed and tested.

### Fixed
- After "what should I remind you?", only your answer counts. A timer,
  another reminder, a question, "yes", "ok" or "no, thanks" are no longer
  turned into a reminder, and the question is forgotten after one message,
  when you start a new chat, switch conversations or change language. A
  repeating request ("every Monday") keeps repeating after you answer.
- "Create a story…", "ponme una canción…" and phrases that only quote "remind
  me" no longer create reminders or memories. "Let me know if it rains" is
  not a reminder (NIDO can't check conditions).
- "Every 8 hours", "every other day", "biweekly", "Monday to Friday": NIDO
  saves the reminder once and says so, instead of claiming it will repeat
  daily or weekly.
- After "Which one?" (deleting or reading a note), a later command with a
  number in it ("set a 2 minute timer") no longer picks a note. The question
  expires after 3 minutes.
- "Every month on the 31st" fires on the 31st (skipping shorter months), not
  on the 1st. Repeating reminders keep their time after a daylight-saving
  change. "Every year on February 30" is not saved with today's date.
- Names: "my sister is called Ana and her birthday is May 3" saves "Ana" (not
  "Ana And"), and that birthday repeats every year. With Reminders turned
  off, saving a birthday no longer creates a reminder.
- "I can't remember the capital of Peru" is answered, not saved as a memory.
  "Today is 14/10" is not calculated as a division.
- The loop guard no longer cuts code blocks, tables or separator lines.
- Showing the backup key now fails safe if the phone's lock status can't be
  read (before, it was treated as a phone with no lock).
- The release build runs the same checks as CI (component tests and download
  pins).

## 0.1.36-alpha — 2026-10-14

### Fixed
- Fewer unrelated sources under answers with multilingual search on. The
  best match now has to stand out from the rest of the results, not just
  pass a fixed score. Measured on the built-in corpus: wrong sources 20 % →
  10 %; with the Vital pack: 33 % → 22 %. No correct answers were lost.

## 0.1.35-alpha — 2026-10-14

### Added
- Reminders that repeat every month or every year: "remind me to pay rent
  on the 1st of every month", "recuérdame cada año el 15 de marzo…", "me
  lembra todo dia 5 de cada mês…". Birthdays saved to memory ("my mom's
  birthday is March 15th") now get a reminder that repeats every year
  (before, it fired only once). "Every 2 days" is still not supported and
  NIDO says so.

### Fixed
- "Ponme un recordatorio para el lunes" → NIDO asks what to remind → the
  answer ("pagar la luz") now creates the reminder. Before, that answer
  went to the model and nothing was saved. "No"/"cancel" drops it.
- Same request, every language (second sweep): "set an alarm for 7",
  "coloca um alarme às 7", "10 minute timer", "agrega una reunión el
  lunes…", "adiciona uma reunião…", "qué hay pendiente", "o que tem
  pendente", and "what's your name / cuál es tu nombre / qual é o seu
  nome" now get their direct answer instead of the model. An alarm with no
  time of day ("alarm for 7") is in the morning, like "wake me at 7".
- Reminder titles no longer keep the calendar date inside ("el 15 de marzo
  el cumpleaños…" → "el cumpleaños de mamá").

## 0.1.34-alpha — 2026-10-13

Fixes from the physical test on the Galaxy Tab A9+.

### Fixed
- The small model could get stuck repeating the same words ("…las
  aluminosas, las aluminosas, las aluminosas…") until it ran out of
  tokens. NIDO now detects the loop, stops generating (saves battery) and
  keeps only the first occurrence. Answers with sources and answers
  without sources now both use a mild repetition penalty (answers without
  sources had none at all).
- My Memory → Reminders showed raw UTC dates ("2026-10-15T01:00:00.000Z",
  which looks like the next day in the Americas). Now: "Wednesday,
  October 14 at 6:00 PM", in the phone's time and language.
- The keyboard autocorrects "Cuánto" to "Canton": "Canton falta para
  navidad" and "Canton es 15% de 200" now work like the real question.
  Countdowns to named days (Christmas, New Year…) accept loose phrasings
  ("falta mucho para navidad", "days till christmas", "falta pouco para o
  natal").
- "Ayúdame a planear mi semana…" uses the weekly-plan template instead of
  the model.

## 0.1.33-alpha — 2026-10-13

Measuring the router (the code that decides what to do with each message
before the model).

### Added
- Menu → Telemetry now shows "Route decision (no model)": how long NIDO
  takes to decide on each message (median, p95, max) and where messages
  end up — solved without the model, with the model, "didn't understand",
  or normal conversation. Only times and counts are stored on the phone,
  never the text. "Clear" also clears these.

### Fixed
- Pasting a very long run of digits ("what is 1111…+") made the calculator
  check take quadratic time (about 110 ms with 4,000 characters on a PC,
  likely seconds on a phone), paid several times per message, freezing
  the screen. Anything over 120 characters is no longer treated as a sum.
- A new CI check sends hostile 4,000-character messages (the chat maximum)
  through every router step with a time budget, so a slow pattern can't
  slip in again.

## 0.1.32-alpha — 2026-10-13

Pending items from the backlog, one by one, each with its own tests.

### Added
- Repeating reminders: "remind me every day at 8 to take my pill",
  "recuérdame cada lunes sacar la basura", "me lembra toda sexta de pagar
  a conta". Every day or every week, in Spanish, English and Portuguese.
  The phone fires them on its own (daily/weekly system alarm) even if NIDO
  is closed; the list shows "every Monday at 9:00". "Every month" is still
  not supported and NIDO says so instead of pretending.
- Countdowns: "how many days until Christmas", "cuánto falta para Navidad",
  "quanto falta para o Natal", or any date — counted on the phone, not
  guessed by the model.
- Settings → memory shows whether exact alarms are allowed (Android 12+)
  and a button to allow them; without it, reminders can arrive minutes
  late while the phone sleeps.

### Fixed
- "Ponme un recordatorio para el lunes" (a date but nothing to remind)
  now asks what to remind instead of going to the model. Same for "set a
  reminder for 5pm" and "me põe um lembrete para segunda".
- The restore-with-key screen is now protected from screenshots and
  screen recording, like the screen that shows the key.
- The exact-alarm module was never compiled into the app (it had no
  Android build file).
- NIDO messages accept the same phrasings in all three languages:
  "escríbele a Ana que…", "write to Ana that…", "diz/fala/escreve para a
  Ana que…", "send Ana a NIDO message saying…", "manda pelo NIDO para…".
  "Tell me that…" / "diz pra mim…" are no longer taken as a message to a
  contact called "me". The outbox note says the same in every language.
- Deleting a reminder from My Memory now also cancels its scheduled
  notification.

## 0.1.31-alpha — 2026-10-13

Audit of the assistant loop in Spanish, English and Portuguese: ~200
real phrases sent through the same chain the chat uses.

### Fixed
- "Manda por nido a Ana que llego tarde" — the exact phrasing NIDO itself
  suggests when the text is missing — went to the model and failed. Also
  "envía por nido a Ana: …" and "mándale a Ana por nido que …".
- "Cancel the timer" / "cancela el temporizador" / "cancela o temporizador"
  cancel it (before, the model could say it did without doing anything).
- "Forget my favorite color" / "olvida…" / "esqueça…" get an honest answer
  (where to delete it: menu → My Memory) instead of a possible fake "done".
- "My mom's birthday is March 15" is saved with its reminder in English
  too (Spanish and Portuguese already were).
- "Add a meeting on Monday at 9", "marca reunião segunda às 9", "minha
  agenda desta semana", "what's pending", "qué tengo pendiente", "hora",
  "time please", "2 to the power of 8" now reach their feature.
- Event titles ending in "-ão" before a weekday lost their last letter
  ("reunião segunda" → "reuniã").
- Spanish and Portuguese share verbs ("anota que…"): with the app in
  Portuguese the answer was in Spanish. The app language now decides when
  the phrase isn't clearly the other language.
- Dates and messages from notes, NIDO inbox, calendar and conversion
  errors are in the app language (they were always Spanish).
- Conversions show 4 decimals ("3.1069 mi", not "3.1068559612 mi").
- The weekly plan uses 24-hour times in Spanish and Portuguese.
- Saving a person says "I'll remember Marta (mom)" instead of "saved to my
  contacts", which sounded like the phone's contacts.

## 0.1.30-alpha — 2026-10-13

Everyday phrases that went to the small model (which can invent the time
or a result) now have a direct, exact answer.

### Fixed
- "Tell me the time" / "dime la hora" / "me diz as horas" read the clock
  instead of asking the model.
- "How many miles are 10 km" also in the feminine Spanish and Portuguese
  forms ("cuántas millas son 10 km", "quantas milhas são 10 km").
- "Open youtube.com" works without typing https:// (the confirmation still
  shows the full address). File names like "notas.pdf" are not links.
- "Set a reminder for 5pm", "pon una alarma a las 7", "don't let me
  forget to call mom", "no me dejes olvidar comprar pan" create the
  reminder directly.
- "La raíz de 16" without "cuadrada" is the square root.

## 0.1.29-alpha — 2026-10-13

Security and privacy fixes from the October 13 audit, plus the
maintenance updates (Dependabot) already on main.

### Security
- Deleting a note or reminder through the assistant now only happens if
  what you confirmed is what is stored. The confirmation showed the name
  the model sent; text hidden in a document or message could make it ask
  to delete one note while showing you another name.
- The backup key is shown in a layer of the app's own window, which is
  protected from screenshots, screen recording and the Recents preview.
  The shared key dialog from 0.1.27 used a separate window that the
  protection might not cover.
- Restoring a backup on a phone without an encryption key is refused (use
  "Restore with the backup's key"): there was no way to check the file,
  and a crafted one could be accepted. With a key, a backup is only
  accepted if it actually opens with it.
- Files extracted from a backup bundle are deleted after restoring.
- Release builds use third-party GitHub Actions pinned to exact commits:
  the job that signs the APK no longer trusts a movable tag.

### Privacy
- Notifications sent right away (scheduled task results, overdue
  reminders at startup) use the reminders channel, hidden on the lock
  screen. They used the default channel, which showed the text — and
  scheduled tasks can read your notes since 0.1.24.

### Changed
- One rule for every backup-key gate (create, view, rotate, restore, in
  Backup and in Settings): unlock with your fingerprint or PIN; if the
  phone has neither, NIDO warns you clearly and continues, instead of
  blocking in some places and not in others.
- Android version code bumped again (it had stayed at 19 since 0.1.18);
  backups record the right app version.

## 0.1.28-alpha — 2026-10-12

Everything the full audit found, fixed. Mostly words in the wrong language.

### Fixed
- NIDO-to-NIDO errors now always speak your language. A few screens
  still showed the transport's raw technical Spanish; they now use
  the same plain-language error mapping as the rest of the NIDO
  screen, in Spanish, English and Portuguese.
- The overdue-reminder notification shown at startup always had a
  Spanish title; it now uses the localized title, like every other
  notification.
- The crash report you can copy from About is written in your
  language too (its headings used to be Spanish only).
- The guide and the empty Contacts state no longer tell you to scan
  the other person's code: there is no camera in the app yet.
  Pairing is show your code, paste theirs as text — which is what
  the pairing screen already said.

### Under the hood
- The component test suites run in CI again. They had been red and
  invisible since October 10 (stale test mocks and untransformed
  Expo modules); all 5 suites pass now, and CI fails if they break.
- Corrected the security roadmap's baseline table: it still said
  "not done" for screenshot/clipboard protection, data-extraction
  rules and physical two-device tests. All three were already in.

## 0.1.27-alpha — 2026-10-12

One backup flow, the same from every entry point.

### Fixed
- Creating a backup from Settings showed the encryption key in a
  system alert whose text cannot be copied: the key could only be
  written down by hand or photographed, and that screen had no way
  to save the backup to a folder. Settings now uses the same
  copyable key dialog as the backup screen (secure copy that clears
  itself after 60 seconds, with a visible confirmation) and adds
  the "Save to Downloads" button, which stores the encrypted backup
  files in a folder you pick. The key itself is never written to
  that folder, and the unlock check before showing it is unchanged.

## 0.1.26-alpha — 2026-10-12

Security fix for devices without biometric hardware.

### Fixed
- The access gate only asked Android about biometrics. On a device
  with no fingerprint or face hardware (for example a Galaxy Tab A9+),
  setting a system PIN was invisible to the gate: the lock screen
  claimed "no biometrics or PIN set up" with the PIN in place, and
  protected actions such as creating a backup failed with
  "Authentication cancelled." The gate now also reads the enrolled
  security level, so a device credential (PIN, pattern or password)
  counts as enrollment and the system prompt accepts it — the
  fallback the gate's policy always documented.

## 0.1.25-alpha — 2026-10-12

The in-app guide learns everything the last versions added, and the
loose ends found while physically testing 0.1.24 are fixed.

### The guide
- The Memory lesson now explains how your memory is organized
  (Facts, People, Notes, Reminders) and teaches by doing: tap a
  save example, then the matching question ("My mom's name is
  Marta" → "What's my mom's name?", your favorite color, where you
  live, your birthday), in Spanish, English and Portuguese.
- The Reminders lesson includes the timer, the Notes lesson the
  quick "note: …" form, and the Privacy lesson answers "Where do
  you store my data?" — every guide example is verified by an
  automated test against the real routers in the three languages.

### Fixed
- "Which one?" now waits for your answer. When reading or deleting
  matched several notes or reminders, the reply ("cumpleaños",
  "the first one", "cancel") started a new turn and the choice was
  lost; the question now keeps its state between messages.
- Dictation fusions in memory questions: "mima" (a fused "mi
  mamá") and its family now reach the memory answer ("Tu mamá se
  llama Marta.") instead of falling through to the model.
- The create-event confirmation dialog showed the raw UTC instant
  ("2026-10-16T17:00:00.000Z"); it now shows the local date and
  time in your language.

### Documentation
- The Bluetooth identity limitation is closed: the fix (NIDO does
  not speak first on incoming connections) is verified on two
  physical devices. Backup wording matches the shipped
  restore-with-key, and the README and roadmap reflect the current
  physical validation status.

## 0.1.24-alpha — 2026-10-12

Fixes from a full reachability audit: every responder the in-app
guide teaches was probed end to end in Spanish, English and
Portuguese, and the phrases that silently fell through were fixed.

### Fixed
- "Where do you store my data?" (and its Spanish/Portuguese forms)
  now reaches the deterministic privacy answer instead of falling
  through: the natural second-person phrasing was not covered, only
  the impersonal one.
- Deleting in natural English works: "delete the birthday note" and
  "delete the dentist reminder" now reach the delete flow with
  confirmation, instead of being deflected to general knowledge.
- The guide's own example "schedule dentist on Friday at 10" now
  creates the event titled "dentist" (it was saved as "dentist on").
- Sending "a message to Juan por nido: …" no longer swallows the
  channel mark into the recipient's name, and the "vía nido" form
  is understood too.
- Notes can be found across languages: a note saved as "cumpleaños
  de Ana" is now read, searched and deleted when you ask for the
  "birthday" note, and searching for "flowers" finds "flores".
- The weekly plan answers in Portuguese when you ask in Portuguese,
  including Portuguese work hours ("trabalho das 8 às 17") and
  family time ("família").
- "Don't forget that Friday is Ana's birthday" (Spanish, English,
  Portuguese) now creates the reminder as well as saving the fact;
  before, the weekday-only date was silently dropped.
- Scheduled tasks can actually read your notes (a task asking to
  "search my notes" answered "you have no notes" even when you
  did), and they answer in your language, Portuguese included.
- Note search ignores filler openings ("busca en mis notas algo
  sobre flores" now searches for "flores").
- The English birthday answer for a relative no longer starts with
  a lowercase letter.

### Internal
- The audit's 118 probes now live in the test suite as permanent
  end-to-end composition tests (chat and scheduled tasks), so a
  responder can no longer be green piece by piece while the
  composed path is broken.

## 0.1.23-alpha — 2026-10-12

### Fixed
- Asking back about your own life now works in your own words, not
  just in a few fixed phrasings. Since 0.1.22, telling NIDO things
  saves them ("My favorite color is green" is stored), but generic
  questions like "What's my favorite color?", "Where do I live?" or
  "What car do I have?" still fell through to the offline knowledge
  base, which knows nothing about you. For first-person questions
  the chat now checks your saved memory first: when a saved fact
  clearly matches, the answer quotes it ("From what you told me:
  …") in Spanish, English and Portuguese. When nothing matches,
  the question follows the exact same path as before, so questions
  about your documents and ordinary small talk are untouched.

## 0.1.22-alpha — 2026-10-12

### Fixed
- Telling NIDO about your life in plain words now actually saves it.
  The chat only sent a message to the agent when it sounded like an
  explicit command ("remember that…"), so natural statements fell
  through to the offline knowledge base instead: "My mom's name is
  Marta" was answered with a Madrid Metro station, "What's my mom's
  name?" could not be answered from memory, and even "Set a timer for
  2 minutes" was treated as small talk. The intent gate now checks
  the same detectors the agent itself uses — people, your own name,
  implicit facts, memory questions, timers, reminders and weekly
  plans — in Spanish, English and Portuguese.

## 0.1.21-alpha — 2026-10-12

A new model in the catalog, and a full audit of how NIDO treats every
model it ships. Each catalog entry was checked against its maker's
official specs, and the mismatches were fixed: memory estimates that
were far too optimistic, chat templates not being used on every route,
and manufacturer sampling recipes that never reached the engine.

### Added
- Qwen3-0.6B (Q4_K_M) in the model catalog as an optional download:
  the newest generation of the light model, stronger at following
  instructions than Qwen2.5-0.5B at the same ~0.4GB size. It runs with
  its thinking mode switched off, so it answers directly like the
  other models.
- Manufacturer sampling recipes are now applied per model, under the
  app's per-task settings: Qwen models get their published
  top_p 0.8 / top_k 20, Gemma 4 its top_p 0.95 / top_k 64, and
  LFM2.5 its full official recipe (temperature 0.2, top_k 80,
  repetition penalty 1.05).

### Fixed
- Memory (RAM) estimates before loading a model were far too
  optimistic for the heavy models, because three catalog entries did
  not declare their real architecture. Phi-3.5-mini's context cache
  is about 13x larger than the old estimate (~1.5GB at 4k context),
  Qwen2.5-7B's about 2x. All entries now declare their real profile,
  so the pre-flight check can refuse a load the device cannot hold
  instead of dying mid-conversation.
- Phi-3.5-mini and Qwen2.5-7B now use their own chat templates on the
  adaptive route too, not just in direct chat — the same model no
  longer behaves differently depending on the route.
- LFM2.5-8B-A1B is a reasoning-only model and was treated like a
  plain chat model: with the normal answer budget its replies could
  spend every token thinking and never produce an answer. It now
  gets a 2048-token floor on answer paths, its official sampling
  recipe, and its chain of thought is kept out of the saved answer
  text (the model still reasons; you just read the answer).
- Release notes are now composed from this changelog for the exact
  version being published. Earlier alphas shipped with the previous
  version's notes because the workflow read a static file; the job
  now refuses to publish if the version has no changelog section.

## 0.1.20-alpha — 2026-10-12

Memory that actually saves and answers back, the audit's remaining
routing gaps (P3), and a timer. Every fix came from real phrases —
several from the tablet — and ships with its exact phrase as a
regression test.

### Added
- Timer: "pon un temporizador de 10 minutos" (EN/PT too). A timer is a
  reminder whose time is now + duration, so it rings with the same
  notification and lives in the same list.
- Delete by chat: "borra la nota de la receta", "cancela el
  recordatorio de mañana", "borra todos mis recordatorios". Every
  delete confirms first, naming the item; bulk deletes go one by one
  and stop at the first "no".
- Search inside notes: "busca en mis notas la receta" searches titles
  and bodies.
- Memory queries answered from what you saved: "¿cómo se llama mi
  mamá?", "¿cómo me llamo?", "¿cuándo es mi cumpleaños?", "¿qué coche
  tengo?" — and an honest "you haven't told me that yet" when the data
  isn't there, instead of a made-up answer with a fake source.

### Fixed
- People now save the way people actually type: "Mi mama se llama
  Marta" (no accent), lowercase names, Portuguese forms, more
  relationships (cuñado, suegra, nieto, mejor amigo), and two people
  at once ("mis hijos se llaman Leo y Max"). Introducing yourself
  ("Yo me llamo Ruben", "my name is Ruben") saves your name too.
- Facts without the word "recuerda" now save when they're clearly
  about you ("mi cumpleaños es el 3 de mayo", "vivo en Tucson", "mi
  coche es un Toyota") — birthdays still create their reminder.
  Sensitive numbers are never auto-saved implicitly.
- Numeric dates ("05/11", "11/05/2027") now produce birthday
  reminders, not just spelled-out months.
- Calculator named forms in English and Portuguese: "half of 80",
  "square root of 144", "a metade de 80". Before, they fell to the
  model and came back with an absurd sources panel.
- "Avísame a las 3 de estudiar" and "despiértame a las 7" now create
  reminders (a wake-up at 7 means 7 AM, not 7 PM).
- "Manda un mensaje a Juan" works without saying "por NIDO".
- "Hazme un plan semanal" generates the weekly plan, like
  "planifica mi semana" already did.
- Currency questions ("¿cuántos dólares son 100 pesos?") get the
  honest offline answer instead of an invented exchange rate.
- A note whose body repeats its title is no longer shown twice
  (existing notes are fixed on read; nothing to migrate).
- Source numbers (1, 2, 3…) were clipped inside their circle; the
  badge is now sized for the glyph.

## 0.1.19-alpha — 2026-10-12

Routing audit: normal phrases that never reached the right tool and fell
to the small model instead.

### Fixed
- Reminder lists with a day: "what reminders do I have today / tomorrow"
  (and the Spanish and Portuguese forms) now list that day's reminders.
  Before, the phrase fell to the model and answered from the knowledge
  base — the exact failure seen on the tablet.
- Calculator without a trigger phrase: "15% of 200", "245*38", "9 por 7",
  "45 más 67", "suma 45 y 67", "la mitad de 80", "el doble de 35",
  "raíz cuadrada de 144", "2 elevado a 10", "cuánto es 1,5 por 4",
  "cuánto son 3 docenas", "cuánto sería la propina del 15% de 230".
  A date typed on its own ("12/10/2026") is not treated as a division.
- Conversions asked as questions: "cuántos pies son 2 metros", "cuánto
  es 70 kg en libras", "how many feet are in 2 meters", "quantos pés são
  2 metros". The imperative forms already worked; the question forms
  depended on the model.
- Reminders with the time first ("mañana recuérdame comprar pan", "en
  media hora recuérdame la junta") were saved with no time and would
  never have rung. The time is now read from the whole phrase.
- "Recuerda que mañana tengo dentista" was stored as a memory fact and
  no reminder existed; with a future date and a first-person event it is
  now a reminder. And "recuérdame cómo se llama la capital de Francia"
  is a question again: it no longer creates a junk reminder (or a junk
  memory fact).
- Repeating reminders ("cada día recuérdame tomar la pastilla") were
  silently saved as one-time. Repeats are not supported yet, and the
  confirmation now says so instead of letting you believe it repeats.
- "Ponme un recordatorio para el viernes" no longer saves a reminder
  titled "para".

## 0.1.18-alpha — 2026-10-12

Offensive audit: trying to break the app.

### Fixed
- Reminders at the wrong time: "at 7 in the morning" (es/pt: "de la
  mañana", "da manhã") rang TOMORROW at 19:00; "9 at night" rang at 9:00,
  "2 in the early morning" at 14:00. "In half an hour", "at noon" and "at
  midnight" now work. 29 February no longer becomes 1 March; a date with a
  past year is not moved to next year.
- Calculator: "-2^2" is -4 (was 4); "3!" is no longer answered as 3; huge
  integers are shown as approximate instead of with invented last digits.
  Now understands "15% of 200", "7 x 8", "12 ÷ 4" and decimal commas.
- Settings: two changes close together could erase each other (a tool just
  switched off could come back on), and a write interrupted by the app being
  killed reset every setting. Changes are now queued and written atomically.
- Backup key: copying it now marks it as sensitive (hidden from keyboard
  clipboard history on Android 13+) and clears it after a minute; the key
  shown after creating a backup is in a screenshot-protected dialog.
- Importing documents: files over 25 MB (text) / 100 MB (PDF) are refused
  instead of risking a crash; a PDF without text says so instead of creating
  an empty collection; a failed import no longer leaves hidden data behind.
  Import errors are in the app language.
- Text fields have limits (P2P proposals longer than the other NIDO accepts
  were silently dropped).

## 0.1.17-alpha — 2026-10-12

### Fixed
- NIDO messages (P2P): connection, pairing and QR errors are explained in
  plain words and in the app language ("Bluetooth is off", "bring the
  devices closer…") instead of the transport's technical message.
- Rotating the encryption key: the fingerprint prompt and the errors are in
  the app language (they were always in Spanish).
- Knowledge base: leftover debug instrumentation no longer adds
  "[seed-stage:…]" to errors shown on screen (it only goes to the log now).

## 0.1.16-alpha — 2026-10-12

### Fixed
- Dates and numbers on a dozen screens (network log, agent permissions,
  scheduled tasks, remote tasks, telemetry, negotiations, message times,
  indexing counters) no longer go through Android's Intl. On some devices
  that path can close the app (same crash class fixed for reminders in
  0.1.10). Same format on every phone, in the app language.
- "Remember that…" and saving a person answered in Spanish whatever the app
  language; now in English / Portuguese too. "I'll create a reminder" now
  says "I created" (it was already created).
- Backup errors (wrong key, invalid file, cancelled unlock…) are shown in the
  app language instead of always in Spanish.
- Untranslated labels: "Contacto:" / "Propuesta:" in Negotiations and
  "Backup" in Settings.

## 0.1.15-alpha — 2026-10-12

### Added
- NIDO messages: when you use P2P and Android is still battery-optimizing
  NIDO, the NIDO screen offers to let it run in the background (system
  dialog). Android's battery saver froze NIDO after a while with the app
  closed and the link dropped until it was opened again.

## 0.1.14-alpha — 2026-10-12

### Added
- User guide "Learn to use NIDO" (Settings → Help, and the menu): short
  lessons in six modules with examples you tap to try. Examples are typed
  into the chat, never sent on their own. Lessons say when a tool is
  switched off. A test sends every example of every language through the
  real routers, so the guide can't promise something that doesn't work.
- First-run onboarding (three screens, skippable) on new installs.
- "What reminders do I have" lists pending reminders (es/en/pt).
- Calculator, reminders and memory now also understand English and
  Portuguese phrasing ("what is 245 * 38", "remind me to…", "me lembra
  de…", "lembre que…").

### Fixed
- Reminder confirmations were always in Spanish; now in the app language.

## 0.1.13-alpha — 2026-10-12

Includes 0.1.12, which was not published as a separate release.

### Fixed
- Settings → usage: the knowledge base size now includes the vector index
  built next to a knowledge pack for multilingual search (~45 MB for
  Wikipedia Vital), which wasn't counted.

## 0.1.12-alpha — 2026-10-12

### Fixed
- New installs in Spanish or Portuguese went back to the setup wizard on
  every launch: the start-up check only looked for the English search
  model, which those installs don't download.
- Turning Spanish & Portuguese search on and off quickly could lose the
  second request; requests now run in order and the last one wins.
- A download that failed and was retrying automatically showed an error
  while it was still working; the search setting now waits for the retries.
- Choosing the search model that is already active no longer rebuilds the
  search index.
- Packs declaring a different vector size are searched by keywords only.

## 0.1.11-alpha — 2026-10-12

### Added
- Search in Spanish and Portuguese (Settings → Knowledge base): a
  multilingual search model (multilingual-e5-small, 126 MB, optional) finds
  the right article even when it's written in English. On by default for
  new installs in Spanish or Portuguese; existing installs choose. Search
  index rebuilt in the background; keyword search keeps working meanwhile.
- Wikipedia Vital pack for multilingual search (CC BY-SA 4.0, compiled by
  NIDO), searched in full with a native vector index.

### Fixed
- Dates like "tomorrow" in agent tool requests now use the request's
  reference time (a test failed depending on the day CI ran).

## 0.1.10-alpha — 2026-10-11

### Added
- Share text from any app to NIDO (Android share menu): it opens a new chat
  with the text ready to send; nothing is sent automatically.
- Long-press the NIDO icon: "New chat" and "NIDO messages" shortcuts.
- Quick Settings tile "Ask NIDO" (asks to unlock first if the device is locked).

## 0.1.9-alpha — 2026-10-11

### Changed
- Hardware protection moved to Settings → Security.

### Fixed
- The hardware protection card could disappear without explanation; it
  now always shows and says why it can't be used.
- Agent replies for NIDO messages, pairing code and files are translated
  to English and Portuguese.

## 0.1.8-alpha — 2026-10-11

### Fixed
- The agent handles notes, time and date, unit conversions, the calendar,
  NIDO messages, links and files by code, in Spanish, English and
  Portuguese, without depending on the small model. Notes are read by
  title.
- "Create a note…" and "create an event…" were saved as reminders.
- The knowledge base no longer re-checks every topic on every start.
  Removing a pack also removes its index.
- Settings says "indexing" until a pack is really ready.
- Agent tools no longer format dates through Intl (possible crash on
  Android).

## 0.1.7-alpha — 2026-10-11

### Added
- Optional hardware protection (Android 11+): NIDO's data key is sealed by
  the device's security chip and only opens with PIN, pattern or
  fingerprint. Optional maximum security mode closes NIDO after 30 s, 1 min
  or 5 min in the background. Make a backup before turning it on.

### Fixed
- Contacts: searching contacts never worked on Android (the code used an
  iOS-only API). Search now ignores accents ("Ruben" finds "Rubén").
- Contacts, calls and SMS work in Spanish, English and Portuguese without
  depending on the small model: "find contact Ana", "call Ana",
  "text Ana that I'm late". "Call Ana" looks her up and asks you to confirm
  the number.
- Asking for a contact, the calendar or a file no longer sends you to the
  lock screen. NIDO checks the permission first and only asks when it is
  missing.
- Call and SMS confirmations now show the number and the full text, in
  your language.
- Small talk ("good, and you?", "thanks", "ok") gets a direct answer, with
  no source search and no "no sources" note.
- Answers with offline sources stick to the sources. Sentences the sources
  don't support are removed, and if nothing is left NIDO says it doesn't
  know and shows what the source does say.
- Factual questions with no sources get an honest "I don't know" instead
  of an invented answer.
- NIDO never answers with an empty bubble or a fake "Done.".

## 0.1.4-alpha — 2026-10-10

### Added
- The agent action history is kept (encrypted) between sessions, and you can
  delete it.
- Undo for notes and reminders the agent created, from the history.
- `docs/security/MASVS_CHECKLIST.md`: self-assessment against OWASP MASVS,
  with the open gaps listed.

## 0.1.3-alpha — 2026-10-10

### Added
- Scheduled tasks now work. Create one in About → Scheduled tasks: a name,
  what the agent should do, a time and the days. The agent runs it on its
  own and the result is shown in the card and in a notification.
- Schedules accept specific weekdays (for example Monday to Friday).

### Notes
- Tasks run while NIDO is open. If the app is closed at the scheduled time
  the phone shows a notice and the task runs once when the app is opened.
- A scheduled task can read notes, calendar and inbox and save notes. It can
  never send messages, call, pair, open other apps or approve anything.

## 0.1.2-alpha — 2026-10-10

### Added
- Backup screen is reachable from About: create an encrypted backup, view
  and copy your encryption key, rotate the key.
- Security check card in About: verifies on the phone that the database is
  encrypted and that key storage and biometric lock work.
- Agent skills list in About.
- "What the agent did" history in About: every tool the agent used or tried
  to use in the session, with the outcome. Content is never stored.
- Agent permissions in About: turn any tool off. A disabled tool is never
  run, and confirmations cannot be relaxed.
- Restore a backup made with a different key (another phone, an earlier
  install, or before rotating): Settings → Restore with the backup's key.
- "Know its limits" notice and a privacy summary in About.
- Privacy policy (`PRIVACY.md`) and terms of use (`TERMS.md`).
- Test that keeps the three languages in sync and forbids untranslated
  dialog text.

### Changed
- Every button declares its role for screen readers; icon-only buttons
  (delete chat, delete collection, voice input) have spoken labels.
- Backup dialogs are translated to English, Spanish and Portuguese, and the
  encryption key is shown in a dialog you can copy from.
- All screens share one look with the chat: warm page background, light
  rounded cards, pill buttons, sentence-case section titles.
- Tone, memory and voice settings follow the light and dark themes (they
  were fixed dark cards before), as does the whole Settings screen.
- Button text on the lock and key-recovery screens has proper contrast.
- The network log shows the newest connections first.
- Screens take their colors from the theme instead of fixed values.
- Dependabot groups minor and patch updates into one weekly pull request.

### Removed
- Unused usage-stats screen.
- Remaining non-legal mentions of the upstream project in comments and
  documents. Licence and attribution are unchanged.

## 0.1.1-alpha — 2026-10-10

### Added
- Remote tasks sent by a paired contact are visible in the NIDO screen, with
  approve and reject buttons.
- Delete a paired contact from the Contacts tab.
- The network log is shown in the About screen.
- Tappable suggestions on the first chat screen.
- Each release ships an `app-release.apk.sha256` file generated by CI.

### Changed
- New look for the chat: theme background, solid bubble for your messages,
  the mascot as NIDO's avatar, rounded composer.
- The header shows "Offline · private" instead of the model's technical name.
- NIDO screen tabs are a segmented control.
- The agent recognizes many more everyday requests in Spanish, English and
  Portuguese.
- Saving a note or creating a reminder right after reading outside content
  asks for confirmation.
- Releases are published once per version; a published APK is never replaced.
- The knowledge-pack sharing tab is hidden until sending and receiving are
  wired.

### Fixed
- Outside content can no longer break out of the block that marks it as
  data for the agent.
- Pairing codes reject names with invisible, control or mixed-alphabet
  look-alike characters, and all-zero keys.
- The handshake rejects a null shared secret.
- Delegation tokens no longer accept unsigned extra content.
- Backups include the knowledge database; an unverifiable file is no longer
  accepted for restore.
- Error and pairing dialogs that showed raw text keys show real text.
- The quick calculator no longer reads "1.000 + 1" as 2.
- "Today at 8" said in the afternoon is scheduled for today, not tomorrow.
- The mascot image has a transparent background (it showed as a white box on
  the dark theme).

### Known limitations
See [docs/ALPHA_RELEASE_NOTES.md](docs/ALPHA_RELEASE_NOTES.md#known-limitations).

## 0.1.0-alpha — 2026-10-10

First public alpha: offline chat, encrypted memory, reminders, document
search, NIDO-to-NIDO messaging over Bluetooth, backup and restore.
