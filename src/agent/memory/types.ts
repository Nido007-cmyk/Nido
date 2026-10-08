/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * NIDO — tipos de la memoria persistente.
 * Modela lo mismo que la memoria de un asistente en la nube (hechos,
 * preferencias, personas, diario), pero todo vive cifrado en el teléfono.
 */

export interface Fact {
  id: string;
  content: string;
  category: "general" | "preference" | "goal" | "event";
  confidence: number; // 0..1 — 1.0 = lo dijo el usuario, menor = inferido
  source: "user" | "inferred";
  createdAt: string;
  updatedAt: string;
}

export interface Preference {
  key: string; // p.ej. 'language' | 'tone' | 'name'
  value: string;
  updatedAt: string;
}

export interface Person {
  id: string;
  name: string;
  relationship?: string;
  notes?: string;
  updatedAt: string;
}

export interface DailyLogEntry {
  id: string;
  day: string; // YYYY-MM-DD
  entry: string;
  createdAt: string;
}

/** Lo que el agente inyecta en el contexto de cada conversación. */
export interface MemorySnapshot {
  facts: Fact[];
  preferences: Preference[];
  people: Person[];
  recentLog: DailyLogEntry[];
}
