
const ALGOLIA_INDEX = "prod_docs";
const ALGOLIA_HITS_PER_INDEX = 5;
const ALGOLIA_APP_ID = "3K1WZ230FA";
// This is a search-only API key, so it's safe to include in the client 
const ALGOLIA_API_KEY = "006dc17ef68287dddb76beb732a72b4a";

interface AlgoliaHit {
  hierarchy?: { lvl0?: string; lvl1?: string; lvl2?: string };
  url?: string;
}

export interface SearchResult {
  title: string;
  url: string;
}

export async function searchAlgolia(query: string): Promise<SearchResult[]> {
  const url = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": ALGOLIA_APP_ID,
      "X-Algolia-API-Key": ALGOLIA_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, hitsPerPage: ALGOLIA_HITS_PER_INDEX }),
  });

  if (!response.ok) {
    throw new Error(`Algolia responded with ${response.status}`);
  }

  const data = (await response.json()) as { hits: AlgoliaHit[] };
  return data.hits
    .map((hit) => ({
      title: hit.hierarchy?.lvl2 ?? hit.hierarchy?.lvl1 ?? hit.hierarchy?.lvl0 ?? "Untitled",
      url: hit.url ?? "",
    }))
    .filter((r) => r.url);
}
