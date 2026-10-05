import React, { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { getThemeColors } from "../theme/colors";
import { frameIndexAtTime, frameOffset, SpriteSheetLayout } from "./spriteSheet";

/**
 * DEV-ONLY PoC screen — V42 idle character preview (Phase 1, Option D).
 *
 * Shows the pre-rendered idle sprite sheet (transparent background) over
 * the Daylight and Night Garden theme backgrounds with a switch control.
 *
 * REMOVABLE: delete src/ui/dev/ + assets/poc/ and the __DEV__ block in
 * App.tsx. Never linked from production home/chat. Not in the i18n
 * catalog on purpose (English labels, dev-only).
 */

// Must match assets/poc/nido_idle_256_sheet.png (4x3 grid, 12 frames).
const SHEET: SpriteSheetLayout = {
  frameWidth: 256,
  frameHeight: 256,
  columns: 4,
  rows: 3,
  frameCount: 12,
  fps: 12,
};
const DISPLAY_SIZE = 256;

type PreviewTheme = "daylight" | "nightgarden";

export function CharacterPreviewScreen({ onClose }: { onClose: () => void }) {
  const [previewTheme, setPreviewTheme] = useState<PreviewTheme>("daylight");
  const [frame, setFrame] = useState(0);
  const startRef = useRef(Date.now());
  const colors = getThemeColors(previewTheme);
  const offset = frameOffset(SHEET, frame);

  useEffect(() => {
    const id = setInterval(() => {
      setFrame(frameIndexAtTime(SHEET, Date.now() - startRef.current));
    }, 1000 / SHEET.fps);
    return () => clearInterval(id);
  }, []);

  const switchLabel = (id: PreviewTheme, label: string) => {
    const active = previewTheme === id;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setPreviewTheme(id)}
        style={[
          styles.switch,
          {
            borderColor: colors.border.default,
            backgroundColor: active ? colors.emerald[400] : colors.bg.card,
          },
        ]}
      >
        <Text
          style={[
            styles.switchText,
            { color: active ? "#FFFFFF" : colors.text.primary },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg.terminal }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text.primary }]}>
          CHARACTER POC (DEV)
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
          <Text style={[styles.closeText, { color: colors.text.primary }]}>Close</Text>
        </Pressable>
      </View>

      {/* Preview pane uses the selected theme's app background on purpose:
          this is what transparency/compositing is being validated against. */}
      <View style={[styles.stage, { backgroundColor: colors.bg.black }]}>
        <View
          style={{
            width: DISPLAY_SIZE,
            height: DISPLAY_SIZE,
            overflow: "hidden",
          }}
        >
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require("../../../assets/poc/nido_idle_256_sheet.png")}
            style={{
              width: SHEET.frameWidth * SHEET.columns,
              height: SHEET.frameHeight * SHEET.rows,
              transform: [{ translateX: offset.x }, { translateY: offset.y }],
            }}
            resizeMode="cover"
          />
        </View>
      </View>

      <View style={styles.switchRow}>
        {switchLabel("daylight", "Daylight")}
        {switchLabel("nightgarden", "Night Garden")}
      </View>

      <Text style={[styles.caption, { color: colors.text.muted }]}>
        V42 idle · 12 frames · 256px · transparent PNG sheet
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: { fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  close: { paddingVertical: 8, paddingHorizontal: 12 },
  closeText: { fontSize: 14, fontWeight: "600" },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    marginBottom: 12,
  },
  switchRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  switch: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  switchText: { fontSize: 14, fontWeight: "600" },
  caption: { fontSize: 12, textAlign: "center" },
});
