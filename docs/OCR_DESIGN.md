# OCR for imported documents — design and the native block

Piece 05 of the bounty collection: Field Atlas's attachment
module (Apache-2.0) — an attachment policy that classifies files
by their own bytes, a dispatcher per kind, and Tesseract OCR on
the phone so a scanned document stops importing empty. See
ATTRIBUTION.md. This document records what NIDO has adopted, what
is designed and ready, and what is **blocked, with evidence** —
so the lane that unblocks it starts from a settled design, not
from zero.

## Adopted and built (TypeScript, tested)

- **Attachment policy** (`src/services/attachmentPolicy.ts`):
  kind decided by magic bytes, not by the provider's MIME or the
  name — PDF header, image signatures (JPEG, PNG, WebP, GIF, BMP,
  HEIC/AVIF), ZIP family split into spreadsheet / archive /
  old-Office refusals with their reasons, text by known extension
  or by a clean UTF-8 sample. Caps: `MAX_OCR_PAGES = 30` (Field
  Atlas's; OCR is slow on a phone).
- **The OCR seam** (`src/services/ocr.ts`), same shape as
  `pdfText.ts`: it looks up the native module by name
  (`NidoOcr`), reports `isOcrAvailable()`, and
  `recognizeImageText(uri, lang)` maps the app language to its
  tessdata code (es→spa, en→eng, pt→por) and throws
  `OcrError("UNAVAILABLE")` when the module is absent — which is
  every current build.
- **Honest scanned-PDF error**: a PDF whose text layer extracts
  empty is noted during import; if nothing at all could be
  imported and OCR is unavailable, the import fails with
  `scannedNoOcr` ("looks like a scanned PDF… this build has no
  OCR") in the three languages, instead of the generic "no text".
  A scanned PDF beside a good text file no longer poisons the
  import — and no longer vanishes silently when it is the only
  file either. The document picker is **not** widened to images
  yet: NIDO does not offer what the build cannot do.

## The native module (designed, NOT built)

`modules/nido-ocr`, following `modules/nido-pdf-text` as the
house template (Expo module, Kotlin, no network):

- API: `recognize(uri: String, tessdataLang: String): Promise<String>`
  — exactly the seam's `NidoOcrNative` interface — plus
  `recognizePdfPages(uri, pages, tessdataLang)` for the scanned
  pages of a PDF, rendered with Android's PdfRenderer like Field
  Atlas does, capped at `MAX_OCR_PAGES`.
- Engine: `cz.adaptech.tesseract4android:tesseract4android:4.9.0`
  (Tesseract 5.5.1 + Leptonica, Apache-2.0), pinned as Field Atlas
  pins it — AAR SHA-256
  `bce5d6413a1a5ae3d7240033fbbc851ba3217d0a08d9769400e17a077f42cb2a`,
  resolved once with network via its group-restricted JitPack
  repository, then built `--offline`.
- Language data: `tessdata_fast` at the pinned revision Field
  Atlas uses (`87416418657359cb625c412a48b6e1d6d41c29bd`):
  `eng.traineddata` SHA-256
  `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`
  is recorded there; `spa` and `por` must be hashed and recorded
  **in this file** before the first build that bundles them.
  Data ships inside the app (no first-use download), checked
  before initialisation, licenses bundled beside it like Field
  Atlas bundles them.
- Importer integration when it lands: image files join the
  picker (kinds from the policy above); a PDF's empty pages go
  through `recognizePdfPages`; recognized text enters the same
  chunk/embed path as extracted text, with the document's
  provenance marked as OCR ("recognized text — check it before
  relying on it", as Field Atlas warns); progress and errors in
  the three languages.

## Why it is not built here (the block, with evidence)

Building an Expo native module needs a JDK to run Gradle and an
Android SDK/NDK set; proving it needs a device or emulator —
OCR that merely compiles is not OCR that works, and this
codebase does not call unproven native code done. This
environment has:

- **No JDK**: `which java` finds nothing, and a full-filesystem
  search for `bin/java` finds nothing — Gradle cannot run at all.
- **No NDK**: the Android SDK present (`~/workspace/android-sdk`,
  from another project's work) has platforms 35/36, build-tools
  and platform-tools, but no `ndk/` directory.
- **No device or emulator** attached to run a build on, and this
  app copy has no generated `android/` project.

So the native module is designed and its seam is live, and the
build is left — deliberately, not silently — to a lane with a
JDK, the SDK/NDK and a phone. Estimated work there: the module
itself is small (one recognize call); the real cost is the
tessdata bundling decision (three languages ≈ 3 × ~2–4 MB in
tessdata_fast), the PDF-page rendering path, and device proof
with real scans in es/en/pt.
