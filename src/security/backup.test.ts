/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { validateBackup } from "./backup";

describe("backup: validateBackup", () => {
  it("rechaza archivo inexistente", async () => {
    const result = await validateBackup("/ruta/que/no/existe.db");
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });
});
