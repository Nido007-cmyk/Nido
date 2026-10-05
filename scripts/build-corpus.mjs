#!/usr/bin/env node
// Dev-machine-only, online script that builds the bundled offline knowledge
// base (assets/corpus/corpus.json) from Wikipedia article summaries. Run
// once when curating/updating the corpus; the app itself never runs this or
// makes network calls. Source: Wikipedia (CC BY-SA 4.0), see docs/MODELS.md.
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";

const TOPICS = [
  // Science & technology
  "Mixture of experts", "Transformer (deep learning architecture)",
  "Quantization (signal processing)", "Retrieval-augmented generation",
  "Vector database", "BM25", "Memory-mapped file", "Large language model",
  "Photosynthesis", "CRISPR", "Quantum entanglement", "Black hole",
  "Plate tectonics", "Antibiotic resistance", "Greenhouse effect",
  "Nuclear fusion", "Semiconductor", "Blockchain", "Public-key cryptography",
  "Open-source software",
  // History
  "Silk Road", "Fall of the Western Roman Empire", "Industrial Revolution",
  "Cold War", "French Revolution", "Age of Discovery", "Byzantine Empire",
  "Mongol Empire", "Renaissance", "Agricultural Revolution",
  // Geography & society
  "Amazon rainforest", "Sahara", "Great Barrier Reef", "Monsoon",
  "Urbanization", "Globalization", "Universal basic income",
  "Renewable energy", "Water scarcity", "Biodiversity loss",
  // Biology & medicine
  "Immune system", "Vaccine", "Neuron", "DNA", "Evolution",
  "Pandemic", "Mental health", "Gut microbiome",
  // Economics & misc
  "Inflation", "Supply and demand", "Game theory", "Behavioral economics",
  "Cryptocurrency", "Artificial general intelligence", "Climate change",
  "GrapheneOS", "Android (operating system)", "Google Play Services",
];

async function fetchSummary(title, attempt = 1) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { "User-Agent": "aoair-corpus-builder/0.1" } });
  if ((res.status === 429 || res.status === 503) && attempt <= 5) {
    const backoffMs = attempt * 5000;
    console.warn(`  429, backing off ${backoffMs}ms (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, backoffMs));
    return fetchSummary(title, attempt + 1);
  }
  if (!res.ok) {
    console.warn(`  skip "${title}": HTTP ${res.status}`);
    return null;
  }
  const data = await res.json();
  if (!data.extract || data.extract.length < 100) {
    console.warn(`  skip "${title}": extract too short`);
    return null;
  }
  return {
    title: data.title,
    source: `Wikipedia — https://en.wikipedia.org/wiki/${encodeURIComponent(data.title.replace(/ /g, "_"))}`,
    body: data.extract,
  };
}

async function main() {
  const outPath = "assets/corpus/corpus.json";
  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : [];
  const haveTitles = new Set(existing.map((d) => d.title));
  const docs = [...existing];

  for (const topic of TOPICS) {
    if (haveTitles.has(topic)) continue;
    process.stdout.write(`Fetching "${topic}"... `);
    const doc = await fetchSummary(topic);
    if (doc) {
      docs.push(doc);
      console.log(`ok (${doc.body.length} chars)`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  mkdirSync("assets/corpus", { recursive: true });
  writeFileSync(outPath, JSON.stringify(docs, null, 2));
  console.log(`\nWrote ${docs.length} documents to ${outPath}`);
}

main();
