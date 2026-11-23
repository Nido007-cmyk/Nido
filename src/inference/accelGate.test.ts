/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";

// ramBudget importa el módulo nativo; sin este doble la cadena de
// importación llega a react-native y el transformador no la puede
// analizar (así lo hacen todos los tests hermanos de la carpeta).
// La política de la puerta recibe las fotos ya hechas: estas
// lecturas nunca se ejercen aquí.
vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 0,
  getMemoryInfo: () => ({ rssBytes: 0 }),
  getProcessorCount: () => null,
  getAvailableMemory: () => null,
}));

import {
  accelLayerBudget,
  adrenoModelOf,
  evaluateAccelGate,
  pickAccelDevice,
  resolveAccelSelection,
  selectGpuDevice,
  selectHexagonDevice,
  type BackendDeviceLike,
} from "./accelGate";
import type { DevicePressureCaps } from "./devicePressure";
import type { RamSnapshot } from "./ramBudget";
import { openClAcceleratesQuant } from "../models/manifest";

const GiB = 1024 ** 3;
const NO_CAPS: DevicePressureCaps = { threadCap: null, ubatchCap: null };

const gpu = (deviceName: string): BackendDeviceLike => ({
  backend: "OpenCL",
  type: "gpu",
  deviceName,
});
const cpu: BackendDeviceLike = { backend: "CPU", type: "cpu", deviceName: "Probe" };
const htp = (deviceName: string): BackendDeviceLike => ({
  backend: "Hexagon",
  type: "accel",
  deviceName,
});

describe("VEL-5 acto 2: la puerta lee la gama Adreno del nombre real", () => {
  it("extrae el modelo de las formas que llama.rn reporta", () => {
    expect(adrenoModelOf("Adreno 750")).toBe(750);
    expect(adrenoModelOf("Adreno (TM) 730")).toBe(730);
    expect(adrenoModelOf("QUALCOMM Adreno(TM) 830")).toBe(830);
    expect(adrenoModelOf("Adreno 619")).toBe(619);
  });

  it("sin Adreno con número legible no hay gama que afirmar", () => {
    expect(adrenoModelOf("Mali-G710 MC10")).toBeNull();
    expect(adrenoModelOf("Probe")).toBeNull();
    expect(adrenoModelOf("Adreno")).toBeNull();
  });

  it("la GPU abre a 700 y no a 699: la gama es el suelo, no una cercanía", () => {
    expect(selectGpuDevice([gpu("Adreno 750"), cpu])?.deviceName).toBe("Adreno 750");
    expect(selectGpuDevice([gpu("Adreno 700"), cpu])?.deviceName).toBe("Adreno 700");
    expect(selectGpuDevice([gpu("Adreno 619"), cpu])).toBeNull();
    expect(selectGpuDevice([cpu])).toBeNull();
    expect(selectGpuDevice([])).toBeNull();
  });

  it("el tipo manda sobre el nombre: un 'accel' llamado Adreno no es la GPU", () => {
    expect(
      selectGpuDevice([{ backend: "Hexagon", type: "accel", deviceName: "Adreno 750" }]),
    ).toBeNull();
  });
});

describe("VEL-5 acto 2: el NPU se detecta por nombre HTP, sin comodines [PP-MIT]", () => {
  it("HTP0 es un dispositivo; 'HTP*' sería una petición, no un nombre", () => {
    expect(selectHexagonDevice([htp("HTP0"), cpu])?.deviceName).toBe("HTP0");
    expect(selectHexagonDevice([htp("HTP*"), cpu])).toBeNull();
    expect(selectHexagonDevice([cpu])).toBeNull();
  });
});

describe("VEL-5 acto 2: la presión cierra la puerta en esa carga", () => {
  it("con topes de presión activos ni GPU ni NPU se intentan", () => {
    const caps: DevicePressureCaps = { threadCap: 3, ubatchCap: 128 };
    const gate = evaluateAccelGate([gpu("Adreno 750"), htp("HTP0"), cpu], caps);
    expect(gate.pressureClosed).toBe(true);
    expect(gate.gpu).toBeNull();
    expect(gate.npu).toBeNull();
  });

  it("sin presión la puerta juzga la lista: GPU elegible y NPU detectado", () => {
    const gate = evaluateAccelGate([gpu("Adreno 750"), htp("HTP0"), cpu], NO_CAPS);
    expect(gate.pressureClosed).toBe(false);
    expect(gate.gpu?.deviceName).toBe("Adreno 750");
    expect(gate.npu?.deviceName).toBe("HTP0");
  });

  it("declarado: la Tab A9+ del dueño (Adreno 619) no abre la puerta", () => {
    const gate = evaluateAccelGate([gpu("Adreno 619"), cpu], NO_CAPS);
    expect(gate.gpu).toBeNull();
    expect(gate.npu).toBeNull();
  });
});

describe("VEL-5 acto 2: la selección nace saneada [patrón PP-MIT]", () => {
  it("una selección que sigue en la lista y calificando se conserva", () => {
    expect(resolveAccelSelection("Adreno 750", [gpu("Adreno 750"), cpu])).toBe("Adreno 750");
    expect(resolveAccelSelection("HTP0", [htp("HTP0"), cpu])).toBe("HTP0");
  });

  it("una selección que ya no está cae a CPU en silencio (null)", () => {
    expect(resolveAccelSelection("Adreno 750", [gpu("Adreno 619"), cpu])).toBeNull();
    expect(resolveAccelSelection("Adreno 750", [])).toBeNull();
    expect(resolveAccelSelection("HTP0", [cpu])).toBeNull();
    expect(resolveAccelSelection(null, [gpu("Adreno 750")])).toBeNull();
  });
});

describe("VEL-5 acto 3: la elección entera — la opción de NPU manda, con su puerta de formato", () => {
  const both = [gpu("Adreno 750"), htp("HTP0"), cpu];

  it("con la opción apagada manda la vía automática del acto 2: la GPU", () => {
    const gate = evaluateAccelGate(both, NO_CAPS);
    expect(pickAccelDevice(gate, both, { npuEnabled: false, npuQuantOk: true, gpuQuantOk: true })).toBe("Adreno 750");
    expect(pickAccelDevice(gate, both, { npuEnabled: false, npuQuantOk: false, gpuQuantOk: true })).toBe("Adreno 750");
  });

  it("con la opción encendida y un formato que el HTP come, la elección expresa gana: el NPU", () => {
    const gate = evaluateAccelGate(both, NO_CAPS);
    expect(pickAccelDevice(gate, both, { npuEnabled: true, npuQuantOk: true, gpuQuantOk: true })).toBe("HTP0");
  });

  it("con la opción encendida pero formato Q4_K_M, el NPU ni se intenta: sigue la GPU", () => {
    const gate = evaluateAccelGate(both, NO_CAPS);
    expect(pickAccelDevice(gate, both, { npuEnabled: true, npuQuantOk: false, gpuQuantOk: true })).toBe("Adreno 750");
  });

  it("sin GPU, la opción encendida con formato bueno elige el NPU; con formato malo, CPU", () => {
    const onlyHtp = [htp("HTP0"), cpu];
    const gate = evaluateAccelGate(onlyHtp, NO_CAPS);
    expect(pickAccelDevice(gate, onlyHtp, { npuEnabled: true, npuQuantOk: true, gpuQuantOk: true })).toBe("HTP0");
    expect(pickAccelDevice(gate, onlyHtp, { npuEnabled: true, npuQuantOk: false, gpuQuantOk: true })).toBeNull();
    expect(pickAccelDevice(gate, onlyHtp, { npuEnabled: false, npuQuantOk: true, gpuQuantOk: true })).toBeNull();
  });

  it("con presión la puerta ya viene cerrada del veredicto: no hay elección", () => {
    const gate = evaluateAccelGate(both, { threadCap: 3, ubatchCap: null });
    expect(pickAccelDevice(gate, both, { npuEnabled: true, npuQuantOk: true, gpuQuantOk: true })).toBeNull();
  });

  it("declarado: en la Tab A9+ (Adreno 619, sin HTP) no hay elección ni con la opción encendida", () => {
    const a9 = [gpu("Adreno 619"), cpu];
    const gate = evaluateAccelGate(a9, NO_CAPS);
    expect(pickAccelDevice(gate, a9, { npuEnabled: true, npuQuantOk: true, gpuQuantOk: true })).toBeNull();
  });
});

describe("0.1.111 (auditoría §7b.4): la puerta de GPU también se condiciona por formato", () => {
  const both = [gpu("Adreno 750"), htp("HTP0"), cpu];

  it("con formato que OpenCL no descarga (Q4_K_M), la GPU no se elige: CPU, sin decir «GPU»", () => {
    const gate = evaluateAccelGate(both, NO_CAPS);
    expect(pickAccelDevice(gate, both, { npuEnabled: false, npuQuantOk: false, gpuQuantOk: false })).toBeNull();
  });

  it("con formato que OpenCL sí descarga (Q4_0), la vía automática sigue eligiendo la GPU", () => {
    const gate = evaluateAccelGate(both, NO_CAPS);
    expect(pickAccelDevice(gate, both, { npuEnabled: false, npuQuantOk: true, gpuQuantOk: true })).toBe("Adreno 750");
  });

  it("la puerta de formato de la GPU no toca la elección expresa del NPU", () => {
    const gate = evaluateAccelGate(both, NO_CAPS);
    expect(pickAccelDevice(gate, both, { npuEnabled: true, npuQuantOk: true, gpuQuantOk: false })).toBe("HTP0");
  });

  it("sin formato declarado (undefined), la GPU tampoco se elige: a ciegas no se acelera", () => {
    const gate = evaluateAccelGate(both, NO_CAPS);
    // openClAcceleratesQuant(undefined) es false en el manifiesto; aquí
    // la elección recibe ese false tal como LlamaEngine lo pasa.
    expect(pickAccelDevice(gate, both, { npuEnabled: false, npuQuantOk: false, gpuQuantOk: openClAcceleratesQuant(undefined) })).toBeNull();
  });
});

describe("VEL-5 acto 2: el presupuesto de capas sale de la RAM real, no de un 99", () => {
  // El modelo de 0.5B del catálogo (397.808.192 B), contexto 4096,
  // arquitectura por defecto (28 capas): con la KV del perfil
  // acelerado el estimador cobra 754.932.288 B en total.
  const spec = { fileSizeBytes: 397_808_192, nCtx: 4096 };

  it("con RAM amplia caben todas las capas del modelo", () => {
    const snapshot: RamSnapshot = { totalRamBytes: 12 * GiB, rssBytes: 1 * GiB };
    expect(accelLayerBudget(spec, snapshot)).toBe(28);
  });

  it("con RAM justa el presupuesto es parcial: ni todas ni ninguna", () => {
    // Disponible por total: 4 − 1 (RSS) − 2 (reserva) = 1 GiB;
    // margen tras el conjunto de trabajo: 318.809.536 B; cada capa
    // cuesta 397.808.192 / 28 ≈ 14,2 MB → 22 capas.
    const snapshot: RamSnapshot = { totalRamBytes: 4 * GiB, rssBytes: 1 * GiB };
    expect(accelLayerBudget(spec, snapshot)).toBe(22);
  });

  it("si el modelo no cabe ni en CPU, no hay presupuesto acelerado", () => {
    const snapshot: RamSnapshot = { totalRamBytes: 3 * GiB, rssBytes: 1 * GiB };
    expect(accelLayerBudget(spec, snapshot)).toBe(0);
  });

  it("a ciegas no se acelera: sin foto, sin tamaño o sin capas, cero", () => {
    const snapshot: RamSnapshot = { totalRamBytes: 12 * GiB, rssBytes: 1 * GiB };
    expect(accelLayerBudget(spec, null)).toBe(0);
    expect(accelLayerBudget({ fileSizeBytes: 0, nCtx: 4096 }, snapshot)).toBe(0);
    expect(accelLayerBudget({ ...spec, nLayer: 0 }, snapshot)).toBe(0);
  });

  it("el presupuesto nunca pasa de las capas que el modelo tiene", () => {
    const snapshot: RamSnapshot = { totalRamBytes: 12 * GiB, rssBytes: 1 * GiB };
    expect(accelLayerBudget({ ...spec, nLayer: 12 }, snapshot)).toBe(12);
  });
});
