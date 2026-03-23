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
Slug: elus-municipaux-2024
Link: https://example.com/datasets/elus-municipaux-2024
Summary: Liste des élus municipaux de France avec leurs mandats
Rows: 524000
License: Licence Ouverte (https://...)
Origin: Ministère de l'Intérieur
Keywords: élus, municipaux
Topics: Politique
Frequency: monthly
Spatial: France métropolitaine
Temporal: 2020-2024

Description:
Ce jeu de données contient la liste des élus municipaux...
(truncated, see dataset page for full description)

Schema (5 columns):
- nom (string): Nom de l'élu [concept: Nom de famille]
- prenom (string): Prénom de l'élu [concept: Prénom]
- age (integer): Âge
- ville (string): Commune [enum: Paris, Lyon, Marseille, ... (150 total)]
- dept (string): Département [labels: 01=Ain, 02=Aisne, ... (101 total)]
- salaire (number): Salaire annuel

Sample data:
nom,prenom,age,ville,dept,salaire
Jean Dupont,Jean,42,Paris,75,52000
Marie Martin,Marie,35,Lyon,69,48000
Pierre Bernard,Pierre,58,Marseille,13,55000
```

Implementation:
- Metadata: key-value lines, only include present optional fields (slug, summary, description, origin, spatial, temporal, keywords, topics, license, frequency)
- Description: include if present, already truncated to 2000 chars in structuredContent
- Spatial/temporal: render as simple text (stringify if object, or extract human-readable fields like label/zone)
- Schema: one line per column with type, description, concept, enum summary, and labels summary
- Labels: shown as `[labels: key1=val1, key2=val2, ... (N total)]` — truncated to first few entries if large
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

When a `query` is provided, include the `_score` column in the CSV output to show relevance ranking.

Implementation:
- Fetch JSON as today (single call, provides total/next/results), then convert rows to CSV locally via `toCSV()` helper
- This avoids a dual HTTP call (one for metadata, one for CSV) and keeps the implementation simple
- The `_score` field is included in CSV when present (i.e., when a query was used)

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

For `value_count`, `cardinality`, `min`, `max`, `sum` metrics: same format as `avg` (single number result).

### 5. `get_field_values`

Format: newline-separated values (avoids ambiguity when values contain commas).

```
Distinct values of "ville" in dataset elus-municipaux-2024:
Paris
Lyon
Marseille
Toulouse
Nice
Nantes
Strasbourg
Montpellier
Bordeaux
Lille
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

Implementation: recursive function to format nested aggregations with increasing indentation. Only show `nonRepresented` at the top level summary line (nested levels don't add useful context for LLMs).

## Implementation Notes

### CSV generation helper

Add a `toCSV(rows: Record<string, any>[]): string` utility in `_utils.ts` using the `csv-stringify/sync` package:
- Extract column keys from first row
- Use `stringify()` with `header: true` and `columns` derived from row keys
- RFC 4180 escaping is handled by the library

This is used as fallback when direct API CSV fetch is impractical (e.g., describe_dataset sample lines where we already have JSON).

### Text formatting helpers

Add formatting functions in `_utils.ts`:
- `formatTextOutput(sections: string[]): string` — joins non-empty sections with blank lines
- `toCSV(rows)` — as above

### No changes to `structuredContent`

The `structuredContent` field remains identical. Only the `text` field in `content` changes.

### CSV edge cases

RFC 4180 escaping (commas, quotes, newlines) is handled by `csv-stringify/sync`. Very long text fields (e.g., description columns) may be truncated in the CSV text output; `structuredContent` retains full values.

### Tests

Existing tests in `tools.test.ts` parse text content via `JSON.parse()` — these will all break. Update strategy:
- Test `structuredContent` for data correctness (assertions on structure/values)
- Test `text` content with string matching for format correctness (contains expected headers, values, formatting)

### Backwards compatibility

Clients using `structuredContent` are unaffected. Clients reading the `text` field get better-formatted output. No breaking changes.
