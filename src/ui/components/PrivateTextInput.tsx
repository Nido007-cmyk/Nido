/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * PrivateTextInput — 0.1.46, teclado incógnito (como Signal).
 *
 * Un TextInput normal que, al recibir el foco, pide al teclado que no
 * aprenda de lo que se escribe (IME_FLAG_NO_PERSONALIZED_LEARNING): sin
 * palabras nuevas en el diccionario personal, sin sugerencias basadas en tus
 * chats, sin historial. Es una petición al teclado: los teclados serios
 * (Gboard, Samsung, SwiftKey) la respetan, pero NIDO no puede obligar a uno
 * que la ignore.
 *
 * Misma API que TextInput (props y ref). Si la función nativa no existe
 * (tests, build viejo) se comporta igual que TextInput.
 */
import React, { forwardRef, useCallback } from "react";
import { TextInput, type TextInputInstance, type TextInputProps } from "react-native";

type FocusEvent = Parameters<NonNullable<TextInputProps["onFocus"]>>[0];

async function markFocusedFieldIncognito(): Promise<void> {
  try {
    const secure = await import("nido-secure-dialog");
    await secure.applyIncognitoKeyboard?.();
  } catch {
    // Best-effort: sin módulo nativo el campo sigue funcionando.
  }
}

export const PrivateTextInput = forwardRef<TextInputInstance, TextInputProps>(function PrivateTextInput(
  { onFocus, ...rest },
  ref,
) {
  const handleFocus = useCallback(
    (e: FocusEvent) => {
      void markFocusedFieldIncognito();
      onFocus?.(e);
    },
    [onFocus],
  );
  return <TextInput ref={ref} {...rest} onFocus={handleFocus} />;
});

/** Mismo tipo de instancia que TextInput, para `useRef<PrivateTextInput>`. */
export type PrivateTextInput = TextInputInstance;
