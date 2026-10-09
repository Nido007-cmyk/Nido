// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

//! `nido-conformance-rs`: independent Rust implementation of the NIDO v0
//! conformance protocol (second implementation, written from the spec
//! documents and the official vectors, not as a translation of the
//! TypeScript reference).
//!
//! The binary (`src/main.rs`) is a thin NDJSON harness adapter; all logic
//! lives here so integration tests can exercise it directly.

pub mod canon;
pub mod eval;
pub mod json;
pub mod num;
