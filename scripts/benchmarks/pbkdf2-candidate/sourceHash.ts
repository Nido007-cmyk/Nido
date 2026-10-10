/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * BENCHMARK CANDIDATE ONLY — NOT REVIEWED, NOT APPROVED FOR PRODUCTION.
 *
 * SHA-256 of pbkdf2.ts (this directory) as committed. The on-device
 * benchmark report carries this hash so a measurement is forever bound to
 * the exact candidate bytes it measured. If pbkdf2.ts changes, regenerate
 * this constant AND note it in the benchmark report — the quarantine
 * tripwire test (src/eval/pbkdf2Quarantine.test.ts) fails the suite while
 * they disagree.
 */

export const PBKDF2_CANDIDATE_SOURCE_SHA256 =
  // 2026-10-09: hash updated after MIT header was added to pbkdf2.ts
  // (commit 8014dbe, legal requirement). The crypto code itself was NOT
  // modified — only the 6-line MIT license header was prepended.
  // Previous hash (pre-header): fc2cdc186c790ede737983202367a58acc728f905ef068bdbbd8c0cb59997877
  "4f163c4cbf1206094c85e53d98639599093b40b95b2ef6ed2e9bdb19b4f6ed19";
