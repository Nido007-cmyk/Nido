# Google Play readiness

> Checked on 2026-11-03 against the published 0.1.74 APK (versionCode 75)
> and `main`. Distribution order stays as decided in
> [DECISIONS.md](DECISIONS.md) D8: GitHub now, F-Droid next, Google Play
> after. This page lists what Play asks for, what NIDO already meets, and
> what is left. Each "met" row names where it was checked.

## Technical requirements

| Requirement | Status | Evidence |
|---|---|---|
| Android App Bundle (.aab) | Ready to build | `.github/workflows/android-apk.yml`: a manual run with `play_bundle` builds and uploads `app-release.aab` as a run artifact. Nothing is published. |
| Target API level | Met | targetSdkVersion 36, read from the 0.1.74 APK manifest. |
| 64-bit native code | Met | arm64-v8a build. Devices without arm64 can't install it; Play allows this. |
| 16 KB memory page support | Met | All 35 native libraries in the 0.1.74 APK have LOAD segments aligned to at least 16 KB. |
| No debuggable build, no backup of user data | Met | `debuggable` not set and `allowBackup=false` in the 0.1.74 manifest. |
| Signing | Decision needed | Play App Signing. To keep updates working between GitHub and Play installs, upload the existing release key so Play signs with the same certificate (`4bd73b2f…`). If Play generates a new key, a phone with the GitHub APK must uninstall before installing from Play, and that deletes its downloaded models. |

## Permissions that need a Play Console declaration

| Permission | Why NIDO uses it | Play status |
|---|---|---|
| `FOREGROUND_SERVICE_SPECIAL_USE` | `AnswerKeepAliveService` (modules/download-wake-lock): finishes an answer the on-device model is writing while the user is in another app. | Needs a declaration, and a video may be asked for. **This is the most likely rejection point.** Play may say a "special use" service is not justified for this. Fallback: drop the service in the Play build and let the answer stop when the app leaves the screen. That was the behaviour before 0.1.65. |
| `FOREGROUND_SERVICE_CONNECTED_DEVICE` | Bluetooth / local Wi-Fi link between two NIDO phones (modules/nido-p2p). | Needs a declaration. It fits the "connected device" type. |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Keeps the P2P link from being cut by the system (modules/nido-p2p). | Restricted. Play accepts it for real-time messaging that cannot use push messaging; NIDO has no server and no push messaging. The justification has to say exactly that. |
| `SCHEDULE_EXACT_ALARM` | Reminders at the exact time. | Allowed for reminders. Off by default on Android 14+; the user grants it. |
| `READ_CONTACTS` | Calling or finding a contact by name. | Personal data. It needs a prominent in-app disclosure before the system prompt, and it has to be in the privacy policy. **Not yet checked on a device: verify the disclosure screen exists.** |
| `RECORD_AUDIO` | Voice dictation (on-device recognizer by default). | Normal runtime permission. |
| `CAMERA` | Optional rate meter in CPR practice (modules/nido-cpr; not offered in the emergency assistant): frames are reduced to motion numbers in memory and dropped. Asked only when the user turns it on. `android.hardware.camera` declared not required. | Normal runtime permission. Must be listed in the privacy policy (done) and in Data safety as "not collected". |
| `READ_CALENDAR` / `WRITE_CALENDAR` | Calendar events the user asks for. | Normal runtime permissions. |
| `ACCESS_FINE_LOCATION` | Only for Bluetooth discovery on Android 11 and older (`maxSdkVersion="30"`, plugins/with-bluetooth-never-for-location.js). | The Play location declaration should say "Bluetooth discovery on Android 11 and older only; NIDO never reads the location". |

## Policies

| Policy | Status | What is left |
|---|---|---|
| Privacy policy | Met | [PRIVACY.md](../PRIVACY.md) in English and Spanish. Play needs a public URL; the GitHub page works. |
| Data safety form | Ready to fill | NIDO sends no user data to the developer or to third parties. Downloads (models and packs from GitHub and Hugging Face, including raw.githubusercontent.com) carry no user data. Answer: "No data collected, no data shared". Also declare encryption at rest and that the user can delete everything. |
| AI-generated content | Met from 0.1.75 | After a thumbs-down, the answer shows **Report** (`src/ui/reportAnswer.ts`, wired in `ChatScreen.tsx`). It opens the user's email app with a draft to the README address: question, answer and app version. The user reviews it, can delete anything, and sends it. NIDO itself sends nothing. To check on a device before submitting. |
| Health and medical information | Declaration needed | The Health apps declaration in Play Console. The disclaimer already ships in the packs and the listing: general information, not a substitute for a first aid course or professional help, call your local emergency number. |
| Content rating | To do | IARC questionnaire in Play Console. |
| Large downloads | Met | Models and packs are data, not code. They are checked by SHA-256 against a signed catalog before use. |
| New personal developer account | To do | Closed test with at least 12 testers for 14 days before production (D8). |

## Store listing

| Item | Status |
|---|---|
| Title, short and full description (en-US, es-ES, pt-BR) | Written in `fastlane/metadata/android/` (Play limits: 30 / 80 / 4000 characters). F-Droid reads the same folder. |
| Changelog for versionCode 75 | Written (`changelogs/75.txt`, three languages). |
| App icon 512×512 | `fastlane/metadata/android/en-US/images/icon.png`, made from `assets/icon-nido.png`. |
| Feature graphic 1024×500 | To do. |
| Phone screenshots (at least 2) | To do: **real screens from a phone**, not the design mockups in `docs/visual/`. |
| Contact email | The one in the README, or a project address chosen by the owner. |

## Order of work before a Play submission

1. Owner decisions:
   - the signing key (upload the existing key);
   - whether to keep the special-use foreground service.
2. Test "Report" on a device (it ships in 0.1.75).
3. Real screenshots and the feature graphic.
4. Play Console: listing, Data safety, permission declarations, Health declaration, content rating.
5. Manual APK workflow run with `play_bundle`, then upload the AAB to the closed-test track.
6. Closed test: 12 testers, 14 days. Then production.
