import type { Predicate } from "@pond/schema/filters/types";
import type { NlFacets } from "@/features/search/lib/nl-query";
import { unitCosine } from "@/shared/lib/vector";

type FacetField = "source" | "type" | "tags" | "creator";

interface VocabEntry {
  field: FacetField;
  value: string;
  vec: Float32Array;
}

const MATCH_THRESHOLD = 0.55;
/** One embedding call pads every row to the longest value, so one long tag or creator name inflates the whole batch. */
const MAX_VALUE_LENGTH = 100;

let vocabSignature = "";
let vocabPromise: Promise<VocabEntry[]> | null = null;

function signatureOf(facets: NlFacets): string {
  return [
    facets.sources.join(","),
    facets.types.join(","),
    facets.tags.slice(0, 200).join(","),
    facets.creators.slice(0, 200).join(","),
  ].join("|");
}

async function buildVocab(facets: NlFacets): Promise<VocabEntry[]> {
  const items: { field: FacetField; value: string }[] = [];
  for (const v of facets.sources) items.push({ field: "source", value: v });
  for (const v of facets.types) items.push({ field: "type", value: v });
  for (const v of facets.tags.slice(0, 200))
    items.push({ field: "tags", value: v });
  for (const v of facets.creators.slice(0, 200))
    items.push({ field: "creator", value: v });

  const usable = items.filter((i) => i.value.length <= MAX_VALUE_LENGTH);
  if (usable.length === 0) return [];
  const { embedTexts } = await import("@/features/enrichment/embeddings");
  const vecs = await embedTexts(usable.map((i) => i.value));
  return usable.flatMap((item, idx) => {
    const vec = vecs[idx];
    return vec ? [{ field: item.field, value: item.value, vec }] : [];
  });
}

function getVocab(facets: NlFacets): Promise<VocabEntry[]> {
  const sig = signatureOf(facets);
  if (sig !== vocabSignature || !vocabPromise) {
    vocabSignature = sig;
    vocabPromise = buildVocab(facets).catch((err) => {
      console.warn("[facet-resolver] vocab build failed", err);
      vocabPromise = null;
      return [];
    });
  }
  return vocabPromise;
}

function toPredicate(field: FacetField, value: string): Predicate {
  switch (field) {
    case "tags":
      return { field: "tags", operator: "some", value: [value] };
    case "creator":
      return { field: "creator", operator: "eq", value };
    case "source":
      return { field: "source", operator: "eq", value };
    case "type":
      return { field: "type", operator: "eq", value };
  }
}

export async function resolveFacets(
  residual: string,
  facets: NlFacets,
): Promise<{ predicates: Predicate[]; residual: string }> {
  const words = residual.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { predicates: [], residual: "" };

  const vocab = await getVocab(facets);
  if (vocab.length === 0) return { predicates: [], residual };

  const { embedTexts } = await import("@/features/enrichment/embeddings");
  const wordVecs = await embedTexts(words);
  const predicates: Predicate[] = [];
  const leftover: string[] = [];

  words.forEach((word, idx) => {
    const wv = wordVecs[idx];
    if (!wv) {
      leftover.push(word);
      return;
    }
    let best: VocabEntry | null = null;
    let bestScore = MATCH_THRESHOLD;
    for (const entry of vocab) {
      const score = unitCosine(wv, entry.vec);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    if (best) predicates.push(toPredicate(best.field, best.value));
    else leftover.push(word);
  });

  return { predicates, residual: leftover.join(" ") };
}
