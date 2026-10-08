/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * KeyLossRecoveryScreen.tsx — NIDO: N4-RECOVERY-UI.
 *
 * The user-visible face of a KeyLossError (code "NIDO_KEY_LOST"): the
 * device's secure key material is gone/corrupt while encrypted databases
 * still exist, and NIDO refused to silently generate a fresh DEK over them.
 *
 * Honesty contract (never violated by this screen):
 * - explains what happened in plain language;
 * - lists the encrypted databases found, by name;
 * - states clearly that data has NOT been deleted;
 * - NEVER implies NIDO can recover the missing key — it cannot;
 * - the reset/recovery path runs ONLY behind an explicit double
 *   confirmation and is wired to the existing
 *   `recoverFromKeyLoss({ confirmed: true })` (archives, never destroys);
 * - never auto-invoked, never a silent fallback.
 *
 * Thin renderer over `keyLossRecovery.ts` (the testable contract). No
 * crypto/storage changes: this file only presents and wires.
 */
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import { calmSpacing, calmRadii, calmShadows } from "./theme/calm";
import { KeyLossError } from "../privacy/keyManager";
import { recoverFromKeyLoss } from "../security/secureDatabase";
import {
  advanceRecoveryPhase,
  buildKeyLossViewModel,
  executeKeyLossRecovery,
  type RecoveryAction,
  type RecoveryPhase,
} from "./keyLossRecovery";

export interface KeyLossRecoveryScreenProps {
  /** The typed contract — consumed, never re-derived. */
  error: KeyLossError;
  /** Called after a confirmed recovery completes: App re-runs startup. */
  onRecoveryComplete: () => void;
  /** Re-runs the startup gate (the key may have reappeared). */
  onRetryCheck: () => void;
}

export function KeyLossRecoveryScreen({
  error,
  onRecoveryComplete,
  onRetryCheck,
}: KeyLossRecoveryScreenProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [phase, setPhase] = useState<RecoveryPhase>("explaining");
  const [failure, setFailure] = useState<string | null>(null);
  const vm = buildKeyLossViewModel(error);

  const go = (action: RecoveryAction) =>
    setPhase((p) => advanceRecoveryPhase(p, action));

  const runRecovery = async () => {
    go("confirm"); // confirming → executing (second explicit gesture)
    setFailure(null);
    try {
      // The ONLY place in the presentation layer that may pass
      // confirmed: true — reachable solely via the double-confirmation
      // machine above.
      await executeKeyLossRecovery({
        recover: (opts) => recoverFromKeyLoss(opts),
      });
      go("succeeded"); // executing → done
      onRecoveryComplete();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
      go("errored"); // executing → failed (fail-closed: nothing else touched)
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.centered}
      style={{ backgroundColor: colors.bg.surface }}
    >
      <Text style={[styles.title, { color: colors.text.primary }]}>
        {t(vm.copy.title)}
      </Text>

      <Text style={[styles.body, { color: colors.text.secondary }]}>
        {t(vm.copy.whatHappened)}
      </Text>

      <Text style={[styles.sectionLabel, { color: colors.text.secondary }]}>
        {t(vm.copy.databasesFound)}
      </Text>
      <View style={styles.dbList}>
        {vm.databases.map((name) => (
          <Text key={name} style={[styles.dbName, { color: colors.amber[400] }]}>
            • {name}
          </Text>
        ))}
      </View>

      <Text style={[styles.body, { color: colors.text.secondary }]}>
        {t(vm.copy.notDeleted)}
      </Text>
      <Text style={[styles.warning, { color: colors.crimson[400] }]}>
        {t(vm.copy.cannotRecoverKey)}
      </Text>

      {phase === "explaining" && (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(vm.copy.startRecovery)}
            onPress={() => go("begin")}
            style={[styles.button, { backgroundColor: colors.emerald[500] }]}
          >
            <Text style={styles.buttonText}>{t(vm.copy.startRecovery)}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(vm.copy.checkAgain)}
            onPress={onRetryCheck}
            style={[styles.button, styles.secondaryButton, { borderColor: colors.text.secondary }]}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.text.primary }]}>
              {t(vm.copy.checkAgain)}
            </Text>
          </Pressable>
        </View>
      )}

      {phase === "confirming" && (
        <View style={styles.confirmBox}>
          <Text style={[styles.confirmTitle, { color: colors.text.primary }]}>
            {t(vm.copy.confirmTitle)}
          </Text>
          <Text style={[styles.body, { color: colors.text.secondary }]}>
            {t(vm.copy.confirmBody)}
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(vm.copy.confirmButton)}
              onPress={runRecovery}
              style={[styles.button, { backgroundColor: colors.crimson[500] }]}
            >
              <Text style={styles.buttonText}>{t(vm.copy.confirmButton)}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(vm.copy.cancel)}
              onPress={() => go("cancel")}
              style={[styles.button, styles.secondaryButton, { borderColor: colors.text.secondary }]}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.text.primary }]}>
                {t(vm.copy.cancel)}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {phase === "executing" && (
        <View style={styles.actions}>
          <ActivityIndicator color={colors.emerald[400]} size="large" />
          <Text style={[styles.body, { color: colors.text.secondary }]}>
            {t(vm.copy.recovering)}
          </Text>
        </View>
      )}

      {phase === "failed" && (
        <View style={styles.actions}>
          <Text style={[styles.warning, { color: colors.crimson[400] }]}>
            {t(vm.copy.recoveryFailed)}
          </Text>
          {failure && (
            <Text style={[styles.body, { color: colors.text.secondary }]}>{failure}</Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(vm.copy.startRecovery)}
            onPress={() => go("retry")}
            style={[styles.button, { backgroundColor: colors.emerald[500] }]}
          >
            <Text style={styles.buttonText}>{t(vm.copy.startRecovery)}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(vm.copy.checkAgain)}
            onPress={onRetryCheck}
            style={[styles.button, styles.secondaryButton, { borderColor: colors.text.secondary }]}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.text.primary }]}>
              {t(vm.copy.checkAgain)}
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flexGrow: 1,
    alignItems: "stretch",
    justifyContent: "center",
    paddingHorizontal: calmSpacing.spacious,
    paddingVertical: calmSpacing.generous,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: calmSpacing.comfortable,
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: calmSpacing.comfortable,
    lineHeight: 20,
  },
  warning: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: calmSpacing.comfortable,
    lineHeight: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: calmSpacing.cozy,
  },
  dbList: {
    alignItems: "center",
    marginBottom: calmSpacing.comfortable,
  },
  dbName: {
    fontSize: 14,
    fontFamily: "monospace",
    marginBottom: calmSpacing.tight,
  },
  actions: {
    alignItems: "stretch",
    gap: calmSpacing.comfortable,
    marginTop: calmSpacing.cozy,
  },
  confirmBox: {
    marginTop: calmSpacing.cozy,
    ...calmShadows.none,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: calmSpacing.comfortable,
  },
  button: {
    paddingHorizontal: calmSpacing.spacious,
    paddingVertical: calmSpacing.comfortable,
    borderRadius: calmRadii.soft,
    alignItems: "center",
    ...calmShadows.none,
  },
  buttonText: {
    color: "#06110c",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
