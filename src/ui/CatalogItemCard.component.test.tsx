/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// CatalogItemCard: la insignia de compatibilidad ES el veredicto de
// la vía de carga (0.1.86): «red» significa que ningún peldaño de
// contexto cabe en este aparato, ni el de emergencia con KV q8. La
// tarjeta, sin embargo, ofrecía «Descargar recurso» (y «Reintentar»)
// también a los rojos: 4,4 GB que el aparato jamás podrá cargar.
// 0.1.90: sin botón de descarga ni de reintento cuando la
// compatibilidad es «red»; en verde el botón sigue y funciona.
// La RAM fijada es la de la Tab A9+ del dueño (3416 MiB), cuyos
// veredictos están censados en src/models/compatibility.test.ts:
// Qwen2.5-7B = red, Qwen3-0.6B = green.
import { jest, describe, it, expect, afterEach } from "@jest/globals";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { cardElevated: "#111", subtle: "#222", modalOverlay: "rgba(0,0,0,0.5)", terminal: "#333" },
      text: { heading: "#fff", primary: "#eee", secondary: "#bbb", dim: "#888", accentEmerald: "#0f0", accentAmber: "#fa0", accentCyan: "#0ff" },
      border: { default: "#333", subtle: "#444" },
      emerald: { 400: "#0f0", border: "#0a0", bgSubtle: "#021" },
      crimson: { 400: "#f66", border: "#a00", bgSubtle: "#200" },
      amber: { border: "#a80", bgSubtle: "#220" },
      cyan: { border: "#088", bgSubtle: "#022" },
    },
    typography: {
      ui: { titleSm: { fontSize: 15 }, caption: { fontSize: 12 }, body: { fontSize: 14 } },
      mono: { xs: { fontSize: 10 } },
    },
  }),
}));

jest.mock("../services/haptics", () => ({
  impact: () => {},
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? k,
    i18n: { language: "es" },
  }),
}));

// La Tab A9+ del dueño: su RAM total real (3416 MiB). Mutable solo
// para que los casos de M-1 fijen aparatos más pequeños; cada caso que
// la mueve la devuelve a la Tab al terminar (afterEach de su describe).
let mockRamBytes = 3416 * 1024 * 1024;
// La lectura en vivo que readRamSnapshot compone: por defecto la
// foto tranquila (RSS en la base de la app y 2 GB libres), cuyo color
// coincide con el canónico en todos los casos viejos de este fichero
// (la cuenta por total manda y es la misma). Los casos de la tanda
// too-heavy la mueven a la foto ocupada y la devuelven en afterEach.
let mockLiveRssBytes = 512 * 1024 * 1024;
let mockLiveAvailBytes = 2 * 1024 * 1024 * 1024;
jest.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => mockRamBytes,
  getMemoryInfo: () => ({ rssBytes: mockLiveRssBytes, totalPssBytes: mockLiveRssBytes }),
  getAvailableMemory: () => ({ availBytes: mockLiveAvailBytes, thresholdBytes: 216 * 1024 * 1024 }),
}));

jest.mock("./components/icons/NidoIcon", () => ({ NidoIcon: () => null }));

jest.mock("../rag/corpusIndexStatus", () => ({
  getCorpusIndexStatus: () => ({}),
  onCorpusIndexStatus: () => () => {},
}));

jest.mock("../utils/safeFormat", () => ({
  displayLang: () => "es",
  formatInt: (n: number) => String(n),
}));

const { CatalogItemCard } = require("./CatalogItemCard");
const { MODEL_CATALOG } = require("../models/manifest");
const byId = (id: string) => MODEL_CATALOG.find((m: { id: string }) => m.id === id);

const baseProps = {
  isActive: false,
  onDownload: () => {},
  onUse: () => {},
  onRemove: () => {},
};

describe("CatalogItemCard: botón de descarga según compatibilidad", () => {
  it("un modelo en rojo («Demasiado pesado») NO ofrece descargar", async () => {
    await render(<CatalogItemCard item={byId("qwen2.5-7b-instruct-q4km")} row={undefined} {...baseProps} />);
    // La insignia roja sí se pinta (es el veredicto honesto)…
    expect(await screen.findByText("catalogItemCard.compat.red")).toBeTruthy();
    // …pero no hay botón de descarga: el archivo no podría cargarse jamás aquí.
    expect(screen.queryByText("catalogItemCard.downloadAsset")).toBeNull();
  });

  it("un modelo en rojo con un error previo tampoco ofrece reintentar", async () => {
    const row = { present: false, downloading: false, progress: 0, error: "falló la red" };
    await render(<CatalogItemCard item={byId("qwen2.5-7b-instruct-q4km")} row={row} {...baseProps} />);
    expect(await screen.findByText("catalogItemCard.compat.red")).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.retryDownload")).toBeNull();
    expect(screen.queryByText("catalogItemCard.downloadAsset")).toBeNull();
  });

  it("un modelo en verde sí ofrece descargar, y el toque llama a onDownload", async () => {
    const onDownload = jest.fn();
    await render(
      <CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={undefined} {...baseProps} onDownload={onDownload} />
    );
    const btn = await screen.findByText("catalogItemCard.downloadAsset");
    expect(btn).toBeTruthy();
    expect(screen.getByText("catalogItemCard.compat.green")).toBeTruthy();
    fireEvent.press(btn);
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect((onDownload.mock.calls[0][0] as { id: string }).id).toBe("qwen3-0.6b-q4km");
  });
});

describe("CatalogItemCard: la familia 3 en la tarjeta", () => {
  it("recién descargado y verificado: ofrece «Seleccionar y usar», nunca «Descargar recurso»", async () => {
    // La aceptación literal del dueño (15:38 MST): tras completarse y
    // verificarse una descarga, la tarjeta ofrece la acción existente
    // «Seleccionar y usar» y su toque llama a onUse.
    const onUse = jest.fn();
    const onDownload = jest.fn();
    const row = { present: true, downloading: false, progress: 0, error: null };
    await render(
      <CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={row} {...baseProps} onUse={onUse} onDownload={onDownload} />
    );
    const btn = await screen.findByText("catalogItemCard.selectUse");
    expect(btn).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.downloadAsset")).toBeNull();
    fireEvent.press(btn);
    expect(onUse).toHaveBeenCalledTimes(1);
    expect((onUse.mock.calls[0][0] as { id: string }).id).toBe("qwen3-0.6b-q4km");
    expect(onDownload).not.toHaveBeenCalled();
  });

  it("el aviso durable del motivo se pinta cuando la fila lo trae", async () => {
    const row = {
      present: false,
      downloading: false,
      progress: 0,
      error: null,
      statusNotice: "El archivo está en el dispositivo pero no se pudo comprobar.",
    };
    await render(<CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={row} {...baseProps} />);
    expect(await screen.findByText("El archivo está en el dispositivo pero no se pudo comprobar.")).toBeTruthy();
  });

  it("con un error en memoria, el aviso durable no compite: manda el error", async () => {
    const row = {
      present: false,
      downloading: false,
      progress: 0,
      error: "La descarga se interrumpió después de 0 bytes",
      statusNotice: "La última descarga se interrumpió antes de terminar.",
    };
    await render(<CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={row} {...baseProps} />);
    expect(await screen.findByText("La descarga se interrumpió después de 0 bytes")).toBeTruthy();
    expect(screen.queryByText("La última descarga se interrumpió antes de terminar.")).toBeNull();
  });
});

describe("CatalogItemCard: un modelo en rojo con una parte ya descargada (0.1.92)", () => {
  const red = () => byId("qwen2.5-7b-instruct-q4km");

  it("dice que hay una parte que ocupa sitio y ofrece borrarla; sigue sin ofrecer descargar", async () => {
    const onDiscardPartial = jest.fn();
    const row = {
      present: false,
      downloading: false,
      progress: 0,
      error: null,
      statusNotice: "Ya hay una parte descargada. Si descargas otra vez, continuará desde ahí.",
      partialBytes: 1200 * 1024 * 1024,
    };
    await render(<CatalogItemCard item={red()} row={row} {...baseProps} onDiscardPartial={onDiscardPartial} />);
    expect(await screen.findByText("installNotice.pausedTooHeavy")).toBeTruthy();
    // El aviso que promete «si descargas otra vez…» no se pinta: no hay botón de descarga.
    expect(screen.queryByText(row.statusNotice)).toBeNull();
    expect(screen.queryByText("catalogItemCard.downloadAsset")).toBeNull();
    fireEvent.press(screen.getByText("catalogItemCard.discardPartial"));
    expect(onDiscardPartial).toHaveBeenCalledTimes(1);
    expect((onDiscardPartial.mock.calls[0][0] as { id: string }).id).toBe("qwen2.5-7b-instruct-q4km");
  });

  it("en rojo y sin parte en disco: ni aviso de «descarga otra vez» ni botón de borrar", async () => {
    const row = {
      present: false,
      downloading: false,
      progress: 0,
      error: null,
      statusNotice: "La última descarga se interrumpió. Si descargas otra vez, empezará desde el principio.",
      partialBytes: null,
    };
    await render(<CatalogItemCard item={red()} row={row} {...baseProps} onDiscardPartial={() => {}} />);
    expect(await screen.findByText("catalogItemCard.compat.red")).toBeTruthy();
    expect(screen.queryByText(row.statusNotice)).toBeNull();
    expect(screen.queryByText("catalogItemCard.discardPartial")).toBeNull();
  });

  it("en verde, el aviso durable y el botón de descarga siguen como en la 0.1.91", async () => {
    const row = {
      present: false,
      downloading: false,
      progress: 0,
      error: null,
      statusNotice: "Ya hay una parte descargada. Si descargas otra vez, continuará desde ahí.",
      partialBytes: 100 * 1024 * 1024,
    };
    await render(<CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={row} {...baseProps} onDiscardPartial={() => {}} />);
    expect(await screen.findByText(row.statusNotice)).toBeTruthy();
    expect(screen.getByText("catalogItemCard.downloadAsset")).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.discardPartial")).toBeNull();
  });
});


describe("CatalogItemCard · tanda too-heavy: crédito simétrico, suelo de la activa y rojo de momento", () => {
  // La foto de la pasada (RSS 868 MiB, término en vivo holgado) y la
  // ocupada del diagnóstico (RSS 950 MiB, 450 MiB libres): las dos
  // fotos cobradas en src/models/compatibility.test.ts.
  const pasadaPhoto = () => {
    mockLiveRssBytes = 868 * 1024 * 1024;
    mockLiveAvailBytes = 2 * 1024 * 1024 * 1024;
  };
  const busyPhoto = () => {
    mockLiveRssBytes = 950 * 1024 * 1024;
    mockLiveAvailBytes = 450 * 1024 * 1024;
  };

  afterEach(() => {
    mockLiveRssBytes = 512 * 1024 * 1024;
    mockLiveAvailBytes = 2 * 1024 * 1024 * 1024;
  });

  it("una tarjeta que NO es la del residente aplica el crédito del residente declarado: verde", async () => {
    pasadaPhoto();
    await render(
      <CatalogItemCard
        item={byId("qwen2.5-0.5b-instruct-q4km")}
        row={undefined}
        {...baseProps}
        residentLoad={{ model: byId("qwen3-0.6b-q4km"), nCtx: 2048, memoryProfile: "default" }}
      />
    );
    // Sin el crédito de sustitución, esta foto juzga al 0.5B en
    // amarillo (cargado encima del residente); la carga real lo
    // juzga con el residente ya fuera: verde, como su canónica.
    expect(await screen.findByText("catalogItemCard.compat.green")).toBeTruthy();
    expect(screen.queryByText(/^catalogItemCard\.compat\.yellow/)).toBeNull();
  });

  it("la activa sin residencia probada no baja de su canónica con la foto ocupada", async () => {
    busyPhoto();
    // 0.1.118: «sin residencia probada» = hay un modelo cargado pero su
    // crédito no se puede calcular (residentLoaded sin residentLoad).
    await render(<CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={undefined} {...baseProps} isActive residentLoaded />);
    // La foto ocupada sin crédito la pintaría roja de momento; la
    // activa no se juzga encima de sí misma sin crédito probado:
    // manda su verde canónico.
    expect(await screen.findByText("catalogItemCard.compat.green")).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.compat.red")).toBeNull();
    expect(screen.queryByText("catalogItemCard.compat.redMoment")).toBeNull();
  });

  it("0.1.118: sin ningún modelo cargado, la activa se juzga con la foto del momento como las demás", async () => {
    busyPhoto();
    await render(
      <CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={undefined} {...baseProps} isActive residentLoaded={false} />
    );
    // Misma foto, misma vara que la tarjeta no activa del test de abajo.
    expect(await screen.findByText("catalogItemCard.compat.redMoment")).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.compat.green")).toBeNull();
  });

  it("rojo de momento: la letra dice «ahora mismo» y el botón de descarga se queda", async () => {
    busyPhoto();
    await render(<CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={undefined} {...baseProps} />);
    expect(await screen.findByText("catalogItemCard.compat.redMoment")).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.compat.red")).toBeNull();
    // El archivo podrá cargarse en un momento tranquilo: descargarlo
    // no es prometer 4,4 GB muertos, y el botón no desaparece.
    expect(screen.getByText("catalogItemCard.downloadAsset")).toBeTruthy();
  });
});

describe("CatalogItemCard: la entrada de embeddings enseña su veredicto (M-1)", () => {
  // Los veredictos del e5 multilingüe (132 MB) medidos contra
  // computeCompatibility en el acto 0 del paso: verde en la Tab
  // (3416 MiB), amarillo a 2,8 GB, rojo a 2 GB. Hasta este paso la
  // puerta por clase devolvía «unknown» para embeddings y la fila no
  // pintaba insignia ni frenaba el gesto en rojo.
  const e5 = () => byId("multilingual-e5-small-q8");

  afterEach(() => {
    mockRamBytes = 3416 * 1024 * 1024;
  });

  it("en verde (la Tab): pinta la insignia verde y ofrece descargar", async () => {
    await render(<CatalogItemCard item={e5()} row={undefined} {...baseProps} />);
    expect(await screen.findByText("catalogItemCard.compat.green")).toBeTruthy();
    expect(screen.getByText("catalogItemCard.downloadAsset")).toBeTruthy();
  });

  it("a 2,8 GB: verde, porque carga tal cual (0.1.120)", async () => {
    // Hasta la 0.1.119 la insignia pasaba el modelo de búsqueda por la
    // escalera de los de chat y pintaba amarillo («menos contexto»),
    // pero embed.ts siempre lo carga a 512 y sin escalera: con 2,8 GB
    // cabe (presupuesto 307 MiB, carga ≈170). La insignia dice ahora lo
    // que hace la carga de verdad.
    mockRamBytes = Math.floor(2.8 * 1024 * 1024 * 1024);
    await render(<CatalogItemCard item={e5()} row={undefined} {...baseProps} />);
    expect(await screen.findByText("catalogItemCard.compat.green")).toBeTruthy();
    expect(screen.queryByText(/^catalogItemCard\.compat\.yellow/)).toBeNull();
  });

  it("en rojo (2 GB): pinta la insignia roja y NO ofrece descargar", async () => {
    mockRamBytes = 2 * 1024 * 1024 * 1024;
    await render(<CatalogItemCard item={e5()} row={undefined} {...baseProps} />);
    expect(await screen.findByText("catalogItemCard.compat.red")).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.downloadAsset")).toBeNull();
  });
});

describe("CatalogItemCard 0.1.119 · el amarillo dice el contexto", () => {
  const { CatalogItemCard } = require("./CatalogItemCard");
  it("con la memoria de ahora justa, la letra es «ahora … N de M» y no «necesita mucha memoria»", async () => {
    mockLiveRssBytes = 220 * 1024 * 1024;
    mockLiveAvailBytes = 1100 * 1024 * 1024;
    await render(<CatalogItemCard item={byId("qwen3-0.6b-q4km")} row={undefined} {...baseProps} isActive={false} />);
    expect(await screen.findByText(/^catalogItemCard\.compat\.yellowNow/)).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.compat.yellow")).toBeNull();
    mockLiveRssBytes = 512 * 1024 * 1024;
    mockLiveAvailBytes = 2 * 1024 * 1024 * 1024;
  });
});
