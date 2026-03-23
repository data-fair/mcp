# LLM-Friendly Tool Output Formatting

## Problem

All MCP tool text outputs currently use `JSON.stringify(structuredContent)`. JSON is not optimal for LLM consumption:

- LLMs score ~8% lower on accuracy with JSON vs Markdown-KV (ImprovingAgents benchmark)
- JSON uses ~27% more tokens than Markdown-KV for equivalent data
- Markdown tables achieve similar accuracy to JSON with 62% fewer tokens
- JSON escaping degrades comprehension (Aider benchmark)

Sources: Anthropic "Writing Tools for Agents", ImprovingAgents benchmarks, Aider benchmarks.

## Approach

- **Keep `structuredContent` unchanged** — serves machine consumers, backwards compatible
- **Replace `JSON.stringify()` in the `text` field** with LLM-optimized formatting
- **CSV for data rows** — token-efficient, fetched directly from API via `format=csv`
- **Markdown-KV / plain text for metadata** — best accuracy for heterogeneous content

## Design Per Tool

### 1. `search_datasets`

Format: numbered Markdown-KV list.

```
5 datasets found.

- Élus municipaux 2024 (id: elus-municipaux-2024)
  Liste des élus municipaux de France...
  Link: https://example.com/datasets/elus-municipaux-2024

- DPE logements (id: dpe-logements)
  Diagnostics de performance énergétique...
  Link: https://example.com/datasets/dpe-logements
```

Implementation: iterate `structuredContent.datasets`, format each entry inline.

### 2. `describe_dataset`

Format: plain text metadata header, Markdown-KV schema, CSV sample lines.

```
Dataset: Élus municipaux 2024
ID: elus-municipaux-2024
Link: https://example.com/datasets/elus-municipaux-2024
Rows: 524000
License: Licence Ouverte (https://...)
Keywords: élus, municipaux
Topics: Politique
Frequency: monthly

Schema (5 columns):
- nom (string): Nom de l'élu [concept: Nom de famille]
- prenom (string): Prénom de l'élu [concept: Prénom]
- age (integer): Âge
- ville (string): Commune [enum: Paris, Lyon, Marseille, ... (150 total)]
- salaire (number): Salaire annuel

Sample data:
nom,prenom,age,ville,salaire
Jean Dupont,Jean,42,Paris,52000
Marie Martin,Marie,35,Lyon,48000
Pierre Bernard,Pierre,58,Marseille,55000
```

Implementation:
- Metadata: key-value lines, only include present optional fields
- Schema: one line per column with type, description, concept, enum summary
- Sample lines: fetch via API with `format=csv&size=3`

### 3. `search_data`

Format: summary line, CSV data rows, pagination hint.

```
3 results (1245 total)
Filtered view: https://example.com/datasets/elus/full?q=dupont

nom,ville,age
Jean Dupont,Paris,42
Marie Martin,Lyon,35
Pierre Bernard,Marseille,58

Next page available.
```

Implementation:
- Fetch CSV directly from API via `format=csv` parameter
- Still need a JSON call (or response headers) for `total` count and `next` URL
- Strategy: make one JSON call for metadata (`size=0` to get just `total`), then one CSV call for rows. Or: fetch JSON as today, generate CSV from the parsed results (simpler, single call). Choose the simpler approach during implementation.

### 4. `calculate_metric`

Format: plain text key-value.

```
Metric: avg of "salaire"
Dataset: elus-municipaux-2024
Total rows: 524000
Result: 48500
```

For `stats` metric (returns object):
```
Metric: stats of "salaire"
Dataset: elus-municipaux-2024
Total rows: 524000
Result: count=524000, min=18000, max=120000, avg=48500, sum=25410000000
```

For `percentiles` metric:
```
Metric: percentiles of "salaire"
Dataset: elus-municipaux-2024
Total rows: 524000
Result: 1%=18500, 5%=22000, 25%=35000, 50%=48000, 75%=62000, 95%=85000, 99%=105000
```

### 5. `get_field_values`

Format: plain text with comma-separated values.

```
Distinct values of "ville" in dataset elus-municipaux-2024:
Paris, Lyon, Marseille, Toulouse, Nice, Nantes, Strasbourg, Montpellier, Bordeaux, Lille
```

### 6. `aggregate_data`

Format: indented tree with metrics.

With metric:
```
Aggregation on dataset elus-municipaux-2024
Total: 524000 rows | Groups shown: 20 | Rows not shown: 12000
API URL: https://...

- Paris: 45000 rows, avg salaire = 52000
  - Mairie 1er: 5000 rows, avg salaire = 55000
  - Mairie 2e: 3000 rows, avg salaire = 48000
- Lyon: 32000 rows, avg salaire = 48000
  - Mairie 1er: 4000 rows, avg salaire = 49000
```

Without metric (count only):
```
Aggregation on dataset elus-municipaux-2024
Total: 524000 rows | Groups shown: 20 | Rows not shown: 12000
API URL: https://...

- Paris: 45000 rows
  - Mairie 1er: 5000 rows
  - Mairie 2e: 3000 rows
- Lyon: 32000 rows
```

Implementation: recursive function to format nested aggregations with increasing indentation.

## Implementation Notes

### CSV generation helper

Add a `toCSV(rows: Record<string, any>[]): string` utility in `_utils.ts`:
- Extract column keys from first row
- Escape values containing commas, quotes, or newlines (RFC 4180)
- Return header + data rows

This is used as fallback when direct API CSV fetch is impractical (e.g., describe_dataset sample lines where we already have JSON).

### Text formatting helpers

Add formatting functions in `_utils.ts`:
- `formatTextOutput(sections: string[]): string` — joins non-empty sections with blank lines
- `toCSV(rows)` — as above

### No changes to `structuredContent`

The `structuredContent` field remains identical. Only the `text` field in `content` changes.

### Backwards compatibility

Clients using `structuredContent` are unaffected. Clients reading the `text` field get better-formatted output. No breaking changes.
