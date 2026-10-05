.PHONY: help setup install check-android start run-android build-eas test typecheck clean knowledge-pack knowledge-pack-small

help:
	@echo "NIDO - Your Offline Agent"
	@echo "-----------------------------------"
	@echo "make setup        - Guided setup: install the app, build it, developer mode, knowledge packs"
	@echo "make install      - Just install npm dependencies (checks for the Android SDK too)"
	@echo "make start        - Start Expo dev server"
	@echo "make run-android  - Build & run on connected Android device (needs Android SDK)"
	@echo "make build-eas    - Build APK via Expo EAS Cloud (no local Android SDK needed)"
	@echo "make test         - Run unit tests"
	@echo "make typecheck    - Run TypeScript type checking"
	@echo "make clean        - Remove generated native folders & build caches"
	@echo "make knowledge-pack        - Build the Wikipedia Vital Articles pack (~50k articles, hours)"
	@echo "make knowledge-pack-small  - Build a smaller pack (Vital Articles level 4, ~10k articles)"

setup:
	@node scripts/setup.mjs

install:
	npm install
	@$(MAKE) --no-print-directory check-android

# Informational only — never fails `make setup`. npm install is all this repo
# actually needs; the Android SDK/NDK/JDK toolchain is a separate, much
# bigger, machine-level install that neither npm nor this Makefile can do
# for you, so this just tells you up front whether `make run-android` will
# work or whether you need `make build-eas` instead.
check-android:
	@if [ -n "$$ANDROID_HOME" ] && [ -d "$$ANDROID_HOME" ]; then \
		echo "Android SDK found at $$ANDROID_HOME — 'make run-android' should work."; \
	elif [ -n "$$ANDROID_SDK_ROOT" ] && [ -d "$$ANDROID_SDK_ROOT" ]; then \
		echo "Android SDK found at $$ANDROID_SDK_ROOT — 'make run-android' should work."; \
	elif command -v adb >/dev/null 2>&1; then \
		echo "Android platform tools found on PATH (adb) — 'make run-android' should work."; \
	else \
		echo ""; \
		echo "No Android SDK detected on this machine (no \$$ANDROID_HOME, no \$$ANDROID_SDK_ROOT, no adb on PATH)."; \
		echo ""; \
		echo "  'make run-android' needs a local Android SDK + NDK + a JDK. Install Android"; \
		echo "  Studio (it sets this up for you) — see:"; \
		echo "  https://docs.expo.dev/workflow/android-studio-emulator/"; \
		echo ""; \
		echo "  Don't want to install all that? Use 'make build-eas' instead — it builds"; \
		echo "  in the cloud via EAS and needs no local Android SDK at all."; \
		echo ""; \
	fi

start:
	npx expo start --localhost

run-android:
	npx expo prebuild -p android
	npx expo run:android --device

# Use this ONLY if native builds get corrupted or when updating Expo plugins
clean-android:
	npx expo prebuild -p android --clean 
	npx expo run:android

build-eas:
	npx eas-cli build --platform android --profile preview

test:
	npm test

typecheck:
	npm run typecheck

clean:
	rm -rf android .expo node_modules
	npm cache clean --force

# Offline knowledge packs, built on this computer (docs/KNOWLEDGE_PACKS.md).
knowledge-pack:
	npm run pack:build

knowledge-pack-small:
	npm run pack:build -- --level 4
