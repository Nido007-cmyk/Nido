/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Pure error diagnosis for ModelLoadErrorCard.
 *
 * Kept dependency-free (no React Native imports) so it can be unit-tested
 * directly. The component imports { diagnose } from here; behavior is
 * identical to the previous inline implementation plus the storage branch.
 */

export type DiagnosisCategory = "memory" | "corrupt" | "missing" | "storage" | "general";

export interface Diagnosis {
  title: string;
  category: DiagnosisCategory;
  detail: string;
  recommendation: string;
}

export type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Classify a model/install error string into a user-facing diagnosis.
 *
 * The storage branch is checked FIRST: a storage/resource failure (P2
 * "resource" class — the phone itself can't hold the file) must never be
 * blamed on the network or fall through to "general". Patterns cover the
 * P2 insufficientStorage user messages in EN/ES/PT plus common OS-level
 * storage errors (ENOSPC, disk full, quota exceeded).
 */
export function diagnose(error: string, t: TranslateFn): Diagnosis {
  const lower = error.toLowerCase();
  if (
    lower.includes("enospc") ||
    lower.includes("no space") ||
    lower.includes("enough free space") ||
    lower.includes("insufficient storage") ||
    lower.includes("disk full") ||
    lower.includes("out of space") ||
    lower.includes("quota exceeded") ||
    lower.includes("suficiente espacio") ||
    lower.includes("espacio insuficiente") ||
    lower.includes("espaço insuficiente") ||
    lower.includes("não há espaço")
  ) {
    return {
      title: t("modelLoadErrorCard.storage.title"),
      category: "storage",
      detail: t("modelLoadErrorCard.storage.detail"),
      recommendation: t("modelLoadErrorCard.storage.recommendation"),
    };
  }
  if (lower.includes("size mismatch") || lower.includes("verification") || lower.includes("hash")) {
    return {
      title: t("modelLoadErrorCard.corrupt.title"),
      category: "corrupt",
      detail: t("modelLoadErrorCard.corrupt.detail"),
      recommendation: t("modelLoadErrorCard.corrupt.recommendation"),
    };
  }
  if (lower.includes("not found") || lower.includes("no such file")) {
    return {
      title: t("modelLoadErrorCard.missing.title"),
      category: "missing",
      detail: t("modelLoadErrorCard.missing.detail"),
      recommendation: t("modelLoadErrorCard.missing.recommendation"),
    };
  }
  if (lower.includes("memory") || lower.includes("oom") || lower.includes("allocate") || lower.includes("ram")) {
    return {
      title: t("modelLoadErrorCard.memory.title"),
      category: "memory",
      detail: t("modelLoadErrorCard.memory.detail"),
      recommendation: t("modelLoadErrorCard.memory.recommendation"),
    };
  }
  return {
    title: t("modelLoadErrorCard.general.title"),
    category: "general",
    detail: error || t("modelLoadErrorCard.general.detailFallback"),
    recommendation: t("modelLoadErrorCard.general.recommendation"),
  };
}
