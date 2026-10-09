/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// NIDO Protocol Conformance Suite v0 — reference-ts
// Shared Result type. NOT product code: minimal reference for verification only.

export type Ok<T> = { ok: true; value: T };
export type Err<E extends string = string> = { ok: false; error: E };
export type Result<T, E extends string = string> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}
export function err<E extends string>(error: E): Err<E> {
  return { ok: false, error };
}
