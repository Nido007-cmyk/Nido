# MIT License
# Copyright (c) 2026 NIDO contributors
# See LICENSE file for details.
#
# ML-KEM-768 nativo (mlkem-native v2.0.0, vendorizado en mlkem-native/).
# En arm64-v8a se compila también el ensamblador AArch64 verificado.
cmake_minimum_required(VERSION 3.18)
project(nidomlkem C ASM)

set(NIDO_MLKEM_SOURCES nido_mlkem.c nido_mlkem_jni.c)
if(ANDROID_ABI STREQUAL "arm64-v8a")
  list(APPEND NIDO_MLKEM_SOURCES mlkem-native/mlkem_native_asm.S)
else()
  add_compile_definitions(NIDO_MLKEM_PORTABLE)
endif()

add_library(nidomlkem SHARED ${NIDO_MLKEM_SOURCES})
target_include_directories(nidomlkem PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_definitions(nidomlkem PRIVATE MLK_CONFIG_FILE="nido_mlkem_config.h")
target_compile_options(nidomlkem PRIVATE -O2 -std=c99 -Wall -Wextra -fvisibility=hidden)
# Páginas de 16 KB (Android 15+).
target_link_options(nidomlkem PRIVATE "-Wl,-z,max-page-size=16384")
