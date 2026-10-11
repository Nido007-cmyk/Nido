/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { registerRootComponent } from 'expo';
import { installCrashRecorder } from 'ram-monitor';

import App from './App';

// Informe de cierres (Acerca de → Diagnóstico de cierres): instalar el
// registro de fallos lo antes posible, antes de montar la app. Si el build
// nativo no lo soporta, no hace nada.
installCrashRecorder();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
