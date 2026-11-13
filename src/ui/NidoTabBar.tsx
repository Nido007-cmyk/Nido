/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * NidoTabBar: la fila de pestañas de la pantalla NIDO (Chats,
 * Contactos, Enlace, Negociaciones, Packs), como control
 * segmentado.
 *
 * 0.1.89 — hasta la 0.1.88 la fila vivía dentro de NidoScreen con
 * cinco columnas iguales (flex: 1) y el texto sin límite de
 * líneas: en la Tab A9+ del dueño, «Negociaciones», la etiqueta
 * larga en los tres idiomas, no cabía en su quinta parte al
 * tamaño de letra del aparato y la palabra se partía en dos
 * líneas, con la «s» colgando sola (foto del dueño, 2026-11-09).
 * Ahora cada pestaña mide lo que su etiqueta necesita (flexGrow
 * con base automática, sin encogerse nunca), la etiqueta va en
 * una sola línea y la fila vive en un ScrollView horizontal sin
 * indicador: cuando todo cabe se ve repartida como siempre, y
 * cuando no cabe (teléfono estrecho o letra agrandada) la fila
 * se desplaza, pero ninguna etiqueta se parte, se trunca ni se
 * encoge. Extraída a componente propio para que esa garantía
 * tenga su regresión de componente directa.
 */
import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmShadows, calmSpacing } from "./theme/calm";

export interface NidoTabBarItem {
  key: string;
  label: string;
}

interface NidoTabBarProps {
  tabs: ReadonlyArray<NidoTabBarItem>;
  activeKey: string;
  onSelect: (key: string) => void;
}

export function NidoTabBar({ tabs, activeKey, onSelect }: NidoTabBarProps) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.frame}
      contentContainerStyle={styles.tabs}
    >
      {tabs.map(({ key, label }) => {
        const active = key === activeKey;
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(key)}
            style={[styles.tab, active && styles.tabActive]}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const getStyles = (colors: Colors, typography: Typography) =>
  StyleSheet.create({
    // El marco (fondo, radio y márgenes) va en la ventana del
    // ScrollView: queda fijo mientras el contenido se desplaza.
    frame: {
      flexGrow: 0,
      backgroundColor: colors.bg.cardElevated,
      borderRadius: 13,
      marginHorizontal: calmSpacing.comfortable,
      marginVertical: calmSpacing.cozy,
    },
    tabs: { flexDirection: "row", flexGrow: 1, padding: 3 },
    tab: {
      flexGrow: 1,
      flexBasis: "auto",
      flexShrink: 0,
      minHeight: 40,
      paddingVertical: calmSpacing.cozy,
      paddingHorizontal: calmSpacing.comfortable,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
    },
    tabActive: { backgroundColor: colors.bg.card, ...calmShadows.whisper },
    tabText: { ...typography.ui.subtext, fontWeight: "600", color: colors.text.secondary },
    tabTextActive: { color: colors.text.primary },
  });
