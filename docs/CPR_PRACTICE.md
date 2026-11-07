# CPR practice

> Added in 0.1.76. Code: `src/cpr/`, `src/ui/emergency/CprPractice.tsx`,
> `modules/nido-cpr/`. This page says what it does, why it is a practice
> tool only, how it was tested, and what has not been tested yet.

## What it is, and what it is not

CPR practice is a **training tool** for practising chest compressions on
a firm cushion or a CPR manikin. It is not for use on a person, and NIDO
does not offer it in an emergency:

- It opens only from "Practise CPR" on the Emergency tab, below the
  quick guides. The chat never offers it.
- The screen always shows: "Practice mode: do it on a firm cushion or a
  manikin, never on a person. If someone does not respond and is not
  breathing, close this and call your emergency number."
- It has no call button and does not count as emergency help.

In an emergency NIDO does what it already did: it shows the country's
checked emergency number and the NIDO Essentials guide, word for word.

### Why practice only

A tool that prompts the rate and timing of CPR while someone is being
resuscitated is a "cardiopulmonary resuscitation aid" in US law
(21 CFR 870.5210(a), class I). If it also rates the rescuer's CPR in real
time (rate, depth, recoil) it is a "CPR aid with feedback"
(870.5210(b), class II), and with software it needs FDA clearance before
it is offered. Other countries have their own medical-device rules. NIDO
is not a medical device and does not want to be one, so this feature is
a training tool with that intended use stated on the screen, in the app
and here. This is the project's own reading, not legal advice; a
regulatory lawyer should confirm it before any change of intended use.

## What it does

- A beep on every compression at **110 per minute**. The NIDO Essentials
  guide says "100 to 120 per minute". The beep comes from a native
  module (`NidoMetronome`, Android `ToneGenerator` on the alarm stream)
  that schedules each beep on its own thread at absolute times
  (start + k × interval), so the rate does not drift when the JavaScript
  thread is busy.
- "Compressions only" (the default) or **30:2** with a 6-second pause for
  the 2 breaths, as the guide describes.
- The phone's voice reads the guide's lines on hand position and pushing,
  says when to give breaths and when to go back to compressions, and
  reads the guide's line on switching every 2 minutes. In 30:2 that
  reminder waits for the breath pause.
- The screen stays on while it runs.
- **Optional: the camera measures your rate** and says "faster", "slower"
  or "good rate, keep going". Off by default; the camera permission is
  asked only when it is turned on.

Every first-aid sentence on that screen, or read aloud from it, is the
NIDO Essentials guide "CPR for adults and older children", word for word.
`src/cpr/cprCoach.test.ts` compares every line with
`knowledge-packs/nido-esencial/<lang>/02-*.md` in Spanish, English and
Portuguese. If the guide changes and this doesn't, the test fails. No AI
model writes anything there.

## How the camera meter works

1. **On the phone, per frame** (`CprMotionCore.kt`; the same algorithm in
   `src/cpr/frameMotion.ts`). Camera2 with no preview, front camera, low
   resolution, about 30 frames per second, luminance only. The frame is
   split into a 4 × 3 grid. For each block NIDO takes a row profile and a
   column profile and measures how far each moved since the previous
   frame (to half a sample). That gives 36 numbers per frame. The frame
   buffer is closed straight away: no image is stored, shown or sent. There is no camera preview on screen
   by design. The camera is on only while the practice is running with
   the meter turned on **and NIDO is in view**: going to the background
   (home button, screen lock, another app, an incoming call) turns it off,
   and it turns back on when you return to the practice. Stopping the
   practice while the camera is still starting turns it off as soon as it
   opens.
   Blocks matter because the person doing compressions fills only part
   of the picture. The best block is a dynamic region of interest, as in
   the published smartphone-camera studies.
2. **Rate** (`src/cpr/rateEstimator.ts`). For each block and axis:
   integrate the motion into a position, resample to 30 Hz, remove slow
   drift, and find the period by autocorrelation between 60 and 180 per
   minute over the last 6 seconds. NIDO keeps the clearest channel and
   checks for the classic double-period error (reading 120 as 60). Below
   a confidence of 0.6 it says nothing.
3. **What is shown and said.** A rate is shown only when two estimates in
   a row agree (within 8 per minute). A sudden jump to half or double is
   not believed until it lasts 3 estimates. A spoken correction needs 3
   matching verdicts in a row, is repeated at most every 8 seconds, and
   "good rate" at most every 30 seconds. During breath pauses nothing is
   measured. **The beep keeps marking 110 whatever the meter says.**

On the phone in the practice: put it on the floor next to the cushion,
screen up. The front camera sees you from below; you grow and shrink in
the picture as you push, and the blocks pick that up (tested below).

## How it was tested

| What | Where | Result |
|---|---|---|
| Guide text identical to the pack, 3 languages | `cprCoach.test.ts` | every line matches |
| Rate within the guide's 100–120; breath pause under 10 s | `cprCoach.test.ts` | pass |
| 30:2 counting, switch reminder in the pause | `cprCoach.test.ts` | pass |
| Estimator on 1-D signals, 100 rates from 80 to 139/min, moderate noise | `rateEstimator.test.ts` | 100 right, 0 wrong |
| Same, strong noise | `rateEstimator.test.ts` | 75 right, 0 wrong, 25 silent |
| Random motion without rhythm, 200 runs | `rateEstimator.test.ts` | never invents a rate |
| **End to end on synthetic video** (frame analysis → estimate → shown rate) | `cameraPipeline.test.ts` | within ±3 to ±5/min from second 5 in every scene below |
| — person fills 40 % or only 20 % of the frame, moves 3 px | | |
| — sensor noise, light flicker, camera shake | | |
| — loose hair, another person moving behind | | |
| — phone landscape (motion on the other axis) | | |
| — phone on the floor screen up (the person grows and shrinks) | | |
| — all of it at once | | |
| — rate changes 90 → 120 | | followed within 6 s |
| Scenes with no compressions (still, fidgeting, someone walking behind, everything at once) | `cameraPipeline.test.ts` | silent in every estimate |
| Kotlin core = TypeScript reference | `scripts/check-cpr-motion-parity.mjs` (CI job `cpr-motion-parity`) | 90 frames, 3,204 numbers, maximum difference 0 |
| Screen: practice warning always shown, no call button, 30:2 re-arms the beep, the camera only starts when turned on, stop turns everything off, the camera turns off in the background and back on when you return | `CprPractice.component.test.tsx` | Jest |
| Camera lifecycle: stopping while it opens closes it as soon as it arrives, going and coming back fast never leaves two cameras open, a late error from an old camera changes nothing | `src/cpr/cameraSession.test.ts` | Vitest |

The synthetic scenes come from what the published studies found hard:
loose hair, a person in the background, a partial view, changing light
(Meinich-Bache et al., 2016–2018).

## What has not been tested yet

- **People and real cameras.** Synthetic video is not a person. The
  published phone-camera study reported a mean error of 3.6 per minute
  for short hair and 8.7 with long hair, on one phone model, indoors.
  The meter needs the protocol below on several phones.
- Outdoor light, night, very low-end cameras, front cameras that only
  give 15 frames per second.
- Depth. NIDO does not measure depth: one camera cannot do it reliably.

## Device test protocol (before each release that touches this)

Equipment: a firm cushion or a CPR manikin, a second phone with a
metronome app as the reference, two NIDO test phones.

1. Compressions only: beep audible at arm's length with the phone on the
   floor, screen stays on 5 minutes, the 2-minute line is spoken, stop
   silences everything.
2. 30:2: count reaches 30, "two breaths", 6 s pause, the beep resumes.
3. Camera on, phone on the floor next to the cushion, screen up.
   Reference metronome at 90, 110 and 130 per minute, 60 s each. Note
   the rate shown every 10 s. Pass: from second 10, within ±10 per
   minute at least 90 % of the time, and the spoken verdict matches.
4. Same with long loose hair, with someone walking behind, and in dim
   light. Write down the results, including failures.
5. No compressions for 60 s (kneeling, talking, looking around): no rate
   and no spoken correction.
6. Deny the camera permission: the practice keeps working with the beep.
7. Check in Settings › Security and privacy that nothing went to the
   network.
8. Lock the screen in the middle of a running practice, leave it locked
   for 30 s, then unlock. Note what is heard while the screen is locked
   (the beep, the voice), what pauses and what keeps running, and whether
   the count and the phase shown after unlocking are still in step with
   the beeps.
9. Receive a phone call in the middle of a running practice and let it
   ring out (repeat answering it briefly). Note what happens to the beep
   and the voice while the call is up, what pauses, and whether the
   practice, its count and the 30:2 cycle resume in step when the call
   ends.

## Sources

- AHA Guidelines for CPR and ECC 2025, as summarized in the NIDO
  Essentials guide (rate 100–120, 30:2, switch every 2 minutes).
- 21 CFR 870.5210, cardiopulmonary resuscitation aid (classes I and II).
- Meinich-Bache Ø. et al., "Chest compression rate measurement from
  smartphone video", BioMedical Engineering OnLine 15, 2016.
- Meinich-Bache Ø. et al., "Real-Time Chest Compression Quality
  Measurements by Smartphone Camera", Journal of Healthcare Engineering,
  2018.
