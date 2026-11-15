/**
 * realSqlcipherDriver.test.ts — sonda permanente de la carrera EPIPE del
 * driver-puente (incidente del programa 0.1.99: el run de CI 43671921091,
 * sobre el push a627a1c2, salió con exit 1 SIN ningún test fallado, por un
 * único error no manejado «write EPIPE» en este driver).
 *
 * La carrera: puente.py responde a la op `close` y RETORNA; si la muerte
 * llegaba sin operaciones en vuelo, el handler de salida no la registraba
 * (`dead` quedaba null para siempre) y la siguiente operación de la cadena
 * escribía en el stdin del proceso muerto. La promesa se rechazaba por el
 * callback de write, pero el socket emitía además el evento 'error' sin
 * listener y Node lo lanzaba como excepción no capturada.
 *
 * El arreglo (solo este driver de pruebas): listener
 * `stdin.on("error", e => kill(e))` y el handler `exit` registra la muerte
 * SIEMPRE vía kill().
 *
 * Qué fija esta sonda, y por qué es determinista en ambos sentidos: tras
 * el cierre se espera SIN intentar ninguna operación, para que el evento
 * de salida del puente se procese entero. Con el arreglo, la muerte queda
 * registrada en ese evento y la op tardía corta en la comprobación de
 * `dead`: rechaza con «puente.py terminó (…)» sin escribir nada. Sin el
 * arreglo, `dead` queda null y la op tardía SÍ escribe en el stdin del
 * muerto: rechaza por el callback con el error del stream (EPIPE o stream
 * destruido), nunca con el error de muerte, y el evento 'error' del
 * stream puede escapar como excepción no capturada (eso es lo que puso el
 * run de CI en rojo). La ventana exacta del evento es de tiempos; el
 * registro de la muerte, no: por eso la sonda aserta el mensaje.
 */
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupFreshDirs, freshDir } from "./b01Utils";
import { makeRealSqlcipherDriver, sqlcipherEngineAvailable } from "./realSqlcipherDriver";

const ENGINE_OK = await sqlcipherEngineAvailable();
const describeEngine = ENGINE_OK ? describe : describe.skip;

const DEATH = /puente\.py terminó/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describeEngine("driver real-sqlcipher · cierre del puente", () => {
  afterAll(() => {
    cleanupFreshDirs();
  });

  it(
    "op tras cierre rechaza en seco: una operación encadenada tras el cierre normal del puente rechaza con el error de muerte y sin excepción no capturada",
    { timeout: 60_000 },
    async () => {
      const uncaught: Error[] = [];
      const onUncaught = (e: Error) => {
        uncaught.push(e);
      };
      process.on("uncaughtException", onUncaught);
      try {
        const dir = freshDir("driver-cierre");
        const driver = makeRealSqlcipherDriver(dir);
        const h = await driver.openDb(path.join(dir, "sonda.db"));

        // Camino feliz primero: el handle funciona antes del cierre, para
        // que el rechazo posterior sea atribuible al cierre y no a un
        // handle roto.
        await h.execAsync("CREATE TABLE t (x TEXT)");
        await h.runAsync("INSERT INTO t (x) VALUES (?)", ["centinela"]);
        const rows = await h.getAllAsync<{ x: string }>("SELECT x FROM t");
        expect(rows).toEqual([{ x: "centinela" }]);

        await h.closeAsync();

        // Esperar a que la salida del puente se procese SIN intentar
        // ninguna op entretanto: cualquier intento intermedio escribiría
        // en el stdin del muerto y contaminaría la señal. El puente sale
        // al responder al `close`; un segundo es margen amplio incluso
        // con la CPU contendida.
        await sleep(1000);

        // Con la muerte registrada, la op tardía corta en `dead` y
        // rechaza en seco con su error, sin escribir. Y queda registrada:
        // la siguiente op rechaza igual.
        await expect(h.execAsync("SELECT 1")).rejects.toThrow(DEATH);
        await expect(h.getAllAsync("SELECT 1")).rejects.toThrow(DEATH);

        // Margen para que cualquier evento tardío del stream hubiera
        // saltado: nada puede haber escapado como no capturado.
        await sleep(300);
        expect(uncaught).toEqual([]);
      } finally {
        process.off("uncaughtException", onUncaught);
      }
    },
  );
});
