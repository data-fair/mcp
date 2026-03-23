# LLM-Friendly Tool Outputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JSON.stringify() text outputs in all 6 MCP tools with LLM-optimized formats (CSV for data rows, Markdown-KV for metadata).

**Architecture:** Each tool's return statement changes only the `text` field in `content[]`. `structuredContent` is untouched. Shared formatting helpers (`toCSV`, `formatTextOutput`) live in `_utils.ts`. Tests switch from `JSON.parse(text)` assertions to `structuredContent` assertions + string matching on `text`.

**Tech Stack:** TypeScript, `csv-stringify/sync` (new dependency), node:test

**Spec:** `docs/superpowers/specs/2026-03-23-llm-friendly-tool-outputs-design.md`

---

### Task 1: Add `csv-stringify` dependency and text formatting helpers

**Files:**
- Modify: `package.json` (add `csv-stringify` dependency)
- Modify: `src/mcp-servers/datasets/tools/_utils.ts` (add `toCSV` and `formatTextOutput`)
- Create: `src/mcp-servers/datasets/tools/_format.test.ts` (unit tests for helpers)

- [ ] **Step 1: Install csv-stringify**

```bash
npm install csv-stringify
```

- [ ] **Step 2: Write failing tests for toCSV**

Create `src/mcp-servers/datasets/tools/_format.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toCSV, formatTextOutput } from './_utils.ts'

describe('toCSV', () => {
  it('should convert rows to CSV with header', () => {
    const rows = [
      { nom: 'Jean Dupont', ville: 'Paris', age: 42 },
      { nom: 'Marie Martin', ville: 'Lyon', age: 35 }
    ]
    const result = toCSV(rows)
    assert.equal(result, 'nom,ville,age\nJean Dupont,Paris,42\nMarie Martin,Lyon,35\n')
  })

  it('should escape values with commas', () => {
    const rows = [{ name: 'Dupont, Jean', city: 'Paris' }]
    const result = toCSV(rows)
    assert.equal(result, 'name,city\n"Dupont, Jean",Paris\n')
  })

  it('should escape values with quotes', () => {
    const rows = [{ name: 'He said "hello"', city: 'Paris' }]
    const result = toCSV(rows)
    assert.equal(result, 'name,city\n"He said ""hello""",Paris\n')
  })

  it('should return empty string for empty rows', () => {
    assert.equal(toCSV([]), '')
  })
})

describe('formatTextOutput', () => {
  it('should join non-empty sections with blank lines', () => {
    const result = formatTextOutput(['Header', '', 'Body', 'Footer'])
    assert.equal(result, 'Header\n\nBody\n\nFooter')
  })

  it('should filter out empty sections', () => {
    const result = formatTextOutput(['Header', '', 'Footer'])
    assert.equal(result, 'Header\n\nFooter')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test src/mcp-servers/datasets/tools/_format.test.ts`
Expected: FAIL — `toCSV` and `formatTextOutput` are not exported from `_utils.ts`

- [ ] **Step 4: Implement toCSV and formatTextOutput in _utils.ts**

Add to `src/mcp-servers/datasets/tools/_utils.ts`:

```typescript
import { stringify } from 'csv-stringify/sync'

/**
 * Convert an array of row objects to CSV string (header + data rows).
 * Uses csv-stringify for RFC 4180 escaping.
 */
export const toCSV = (rows: Record<string, any>[]): string => {
  if (rows.length === 0) return ''
  const columns = Object.keys(rows[0])
  return stringify(rows, { header: true, columns })
}

/**
 * Join non-empty text sections with blank lines.
 */
export const formatTextOutput = (sections: string[]): string => {
  return sections.filter(s => s.length > 0).join('\n\n')
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test src/mcp-servers/datasets/tools/_format.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/mcp-servers/datasets/tools/_utils.ts src/mcp-servers/datasets/tools/_format.test.ts
git commit -m "feat: add toCSV and formatTextOutput helpers with csv-stringify"
```

---

### Task 2: Convert `search_datasets` to Markdown-KV text output

**Files:**
- Modify: `src/mcp-servers/datasets/tools/search-datasets.ts` (text formatting)
- Modify: `src/mcp-servers/datasets/tools.test.ts` (update test assertions)

- [ ] **Step 1: Update the test to assert on structuredContent + text format**

In `src/mcp-servers/datasets/tools.test.ts`, replace the `search_datasets` test:

```typescript
describe('search_datasets', () => {
  it('should search datasets and return formatted results', async () => {
    routes['/catalog/datasets'] = (url) => ({
      count: 2,
      results: [
        { id: 'ds1', title: 'Entreprises', summary: 'Liste des entreprises', page: 'https://example.com/datasets/ds1' },
        { id: 'ds2', title: 'Logements', page: 'https://example.com/datasets/ds2' }
      ]
    })

    const result = await client.callTool({ name: 'search_datasets', arguments: { query: 'entreprises' } })

    // Verify structuredContent
    const sc = result.structuredContent as any
    assert.equal(sc.count, 2)
    assert.equal(sc.datasets.length, 2)
    assert.equal(sc.datasets[0].id, 'ds1')
    assert.equal(sc.datasets[0].title, 'Entreprises')
    assert.equal(sc.datasets[0].summary, 'Liste des entreprises')
    assert.equal(sc.datasets[0].link, 'https://example.com/datasets/ds1')
    assert.equal(sc.datasets[1].summary, undefined)

    // Verify text format
    const text = (result.content as any)[0].text
    assert.ok(text.includes('2 datasets found.'))
    assert.ok(text.includes('Entreprises (id: ds1)'))
    assert.ok(text.includes('Liste des entreprises'))
    assert.ok(text.includes('https://example.com/datasets/ds1'))
    assert.ok(text.includes('Logements (id: ds2)'))
    assert.ok(!text.includes('{'))  // No JSON
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='search_datasets' src/mcp-servers/datasets/tools.test.ts`
Expected: FAIL — text still contains JSON

- [ ] **Step 3: Update search-datasets.ts text output**

In `src/mcp-servers/datasets/tools/search-datasets.ts`, replace the return statement:

```typescript
      const datasetLines = structuredContent.datasets.map((d: any) => {
        let line = `- ${d.title} (id: ${d.id})`
        if (d.summary) line += `\n  ${d.summary}`
        line += `\n  Link: ${d.link}`
        return line
      }).join('\n\n')

      const text = formatTextOutput([
        `${structuredContent.count} datasets found.`,
        datasetLines
      ])

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
```

Add the import at the top:
```typescript
import { getOrigin, buildAxiosOptions, handleApiError } from './_utils.ts'
```
Change to:
```typescript
import { getOrigin, buildAxiosOptions, handleApiError, formatTextOutput } from './_utils.ts'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='search_datasets' src/mcp-servers/datasets/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-servers/datasets/tools/search-datasets.ts src/mcp-servers/datasets/tools.test.ts
git commit -m "feat: convert search_datasets text output to Markdown-KV"
```

---

### Task 3: Convert `describe_dataset` to Markdown-KV + CSV text output

**Files:**
- Modify: `src/mcp-servers/datasets/tools/describe-dataset.ts` (text formatting)
- Modify: `src/mcp-servers/datasets/tools.test.ts` (update test assertions)

- [ ] **Step 1: Update the tests to assert on structuredContent + text format**

In `src/mcp-servers/datasets/tools.test.ts`, update all 3 `describe_dataset` tests. Replace the first test:

```typescript
  it('should return dataset metadata with schema and sample lines', async () => {
    routes['/datasets/ds1/lines'] = () => ({
      results: [
        { _id: 'abc', _i: 1, _rand: 123, nom: 'ACME', ville: 'Paris' },
        { _id: 'def', _i: 2, _rand: 456, nom: 'Globex', ville: 'Lyon' },
        { _id: 'ghi', _i: 3, _rand: 789, nom: 'Initech', ville: 'Paris' }
      ]
    })
    routes['/datasets/ds1'] = (url) => {
      if (url.pathname.includes('/lines')) return undefined
      return {
        id: 'ds1',
        title: 'Entreprises',
        slug: 'entreprises',
        page: 'https://example.com/datasets/ds1',
        count: 1000,
        summary: 'Liste des entreprises',
        keywords: ['entreprise', 'siège'],
        license: { href: 'https://license.example.com', title: 'Open License' },
        schema: [
          { key: '_id', type: 'string' },
          { key: '_i', type: 'integer' },
          { key: '_rand', type: 'integer' },
          { key: 'nom', type: 'string', title: 'Nom', 'x-concept': { title: 'Nom entreprise' } },
          { key: 'ville', type: 'string', title: 'Ville', enum: ['Paris', 'Lyon'], 'x-labels': { Paris: 'Paris', Lyon: 'Lyon' } }
        ]
      }
    }

    const result = await client.callTool({ name: 'describe_dataset', arguments: { datasetId: 'ds1' } })

    // Verify structuredContent
    const sc = result.structuredContent as any
    assert.equal(sc.id, 'ds1')
    assert.equal(sc.title, 'Entreprises')
    assert.equal(sc.slug, 'entreprises')
    assert.equal(sc.count, 1000)
    assert.equal(sc.license.title, 'Open License')
    assert.equal(sc.schema.length, 2)
    assert.equal(sc.schema[0].key, 'nom')
    assert.equal(sc.schema[0].concept, 'Nom entreprise')
    assert.equal(sc.schema[1].key, 'ville')
    assert.deepEqual(sc.schema[1].enum, ['Paris', 'Lyon'])
    assert.deepEqual(sc.schema[1].labels, { Paris: 'Paris', Lyon: 'Lyon' })
    assert.equal(sc.sampleLines.length, 3)
    assert.equal(sc.sampleLines[0].nom, 'ACME')
    assert.equal(sc.sampleLines[0]._id, undefined)

    // Verify text format
    const text = (result.content as any)[0].text
    assert.ok(text.includes('Dataset: Entreprises'))
    assert.ok(text.includes('ID: ds1'))
    assert.ok(text.includes('Rows: 1000'))
    assert.ok(text.includes('License: Open License'))
    assert.ok(text.includes('Keywords: entreprise, siège'))
    assert.ok(text.includes('- nom (string): Nom [concept: Nom entreprise]'))
    assert.ok(text.includes('[labels: Paris=Paris, Lyon=Lyon]'))
    assert.ok(text.includes('Sample data:'))
    assert.ok(text.includes('nom,ville'))
    assert.ok(text.includes('ACME,Paris'))
    assert.ok(!text.startsWith('{'))  // No JSON
  })
```

Replace the truncation tests similarly — assert on `structuredContent` for data, `text` for format:

```typescript
  it('should truncate large enum arrays', async () => {
    const largeEnum = Array.from({ length: 50 }, (_, i) => `val${i}`)
    routes['/datasets/ds2/lines'] = () => ({ results: [{ code: 'val0' }] })
    routes['/datasets/ds2'] = (url) => {
      if (url.pathname.includes('/lines')) return undefined
      return {
        id: 'ds2',
        title: 'Large enums',
        page: 'https://example.com/datasets/ds2',
        count: 100,
        schema: [
          { key: 'code', type: 'string', enum: largeEnum },
          { key: 'small', type: 'string', enum: ['a', 'b'] }
        ]
      }
    }

    const result = await client.callTool({ name: 'describe_dataset', arguments: { datasetId: 'ds2' } })
    const sc = result.structuredContent as any

    assert.equal(sc.schema[0].enum.length, 20)
    assert.equal(sc.schema[0].enumTruncated, true)
    assert.equal(sc.schema[0].enumTotal, 50)
    assert.deepEqual(sc.schema[1].enum, ['a', 'b'])
    assert.equal(sc.schema[1].enumTruncated, undefined)

    // Text should mention truncation
    const text = (result.content as any)[0].text
    assert.ok(text.includes('(50 total)'))
  })

  it('should truncate very long descriptions', async () => {
    const longDescription = 'A'.repeat(3000)
    routes['/datasets/ds3/lines'] = () => ({ results: [] })
    routes['/datasets/ds3'] = (url) => {
      if (url.pathname.includes('/lines')) return undefined
      return {
        id: 'ds3',
        title: 'Long desc',
        page: 'https://example.com/datasets/ds3',
        count: 10,
        description: longDescription,
        schema: []
      }
    }

    const result = await client.callTool({ name: 'describe_dataset', arguments: { datasetId: 'ds3' } })
    const sc = result.structuredContent as any

    assert.ok(sc.description.length < 3000)
    assert.ok(sc.description.endsWith('… (truncated, see dataset page for full description)'))

    const text = (result.content as any)[0].text
    assert.ok(text.includes('Description:'))
    assert.ok(text.includes('truncated'))
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern='describe_dataset' src/mcp-servers/datasets/tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Update describe-dataset.ts text output**

In `src/mcp-servers/datasets/tools/describe-dataset.ts`, update the import and return block.

Add import:
```typescript
import { getOrigin, buildAxiosOptions, encodeDatasetId, handleApiError, toCSV, formatTextOutput } from './_utils.ts'
```

Replace the return statement (after `dataset.sampleLines = ...`) with:

```typescript
      // Build text output
      const metadataLines = [`Dataset: ${dataset.title}`, `ID: ${dataset.id}`]
      if (dataset.slug) metadataLines.push(`Slug: ${dataset.slug}`)
      metadataLines.push(`Link: ${dataset.link}`)
      if (dataset.summary) metadataLines.push(`Summary: ${dataset.summary}`)
      metadataLines.push(`Rows: ${dataset.count}`)
      if (dataset.license) metadataLines.push(`License: ${dataset.license.title} (${dataset.license.href})`)
      if (dataset.origin) metadataLines.push(`Origin: ${dataset.origin}`)
      if (dataset.keywords) metadataLines.push(`Keywords: ${dataset.keywords.join(', ')}`)
      if (dataset.topics) metadataLines.push(`Topics: ${dataset.topics.join(', ')}`)
      if (dataset.frequency) metadataLines.push(`Frequency: ${dataset.frequency}`)
      if (dataset.spatial) metadataLines.push(`Spatial: ${typeof dataset.spatial === 'string' ? dataset.spatial : JSON.stringify(dataset.spatial)}`)
      if (dataset.temporal) metadataLines.push(`Temporal: ${typeof dataset.temporal === 'string' ? dataset.temporal : JSON.stringify(dataset.temporal)}`)

      let descriptionSection = ''
      if (dataset.description) {
        descriptionSection = `Description:\n${dataset.description}`
      }

      let schemaSection = ''
      if (dataset.schema && dataset.schema.length > 0) {
        const schemaLines = dataset.schema.map((col: any) => {
          let line = `- ${col.key} (${col.type})`
          if (col.title) line += `: ${col.title}`
          if (col.description) line += ` — ${col.description}`
          if (col.concept) line += ` [concept: ${col.concept}]`
          if (col.enum) {
            const shown = col.enum.join(', ')
            if (col.enumTruncated) {
              line += ` [enum: ${shown}, ... (${col.enumTotal} total)]`
            } else {
              line += ` [enum: ${shown}]`
            }
          }
          if (col.labels) {
            const entries = Object.entries(col.labels)
            const shown = entries.slice(0, 10).map(([k, v]) => `${k}=${v}`).join(', ')
            if (entries.length > 10) {
              line += ` [labels: ${shown}, ... (${entries.length} total)]`
            } else {
              line += ` [labels: ${shown}]`
            }
          }
          return line
        })
        schemaSection = `Schema (${dataset.schema.length} columns):\n${schemaLines.join('\n')}`
      }

      let sampleSection = ''
      if (dataset.sampleLines && dataset.sampleLines.length > 0) {
        sampleSection = `Sample data:\n${toCSV(dataset.sampleLines).trimEnd()}`
      }

      const text = formatTextOutput([
        metadataLines.join('\n'),
        descriptionSection,
        schemaSection,
        sampleSection
      ])

      return {
        structuredContent: dataset,
        content: [{ type: 'text', text }]
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-name-pattern='describe_dataset' src/mcp-servers/datasets/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-servers/datasets/tools/describe-dataset.ts src/mcp-servers/datasets/tools.test.ts
git commit -m "feat: convert describe_dataset text output to Markdown-KV + CSV"
```

---

### Task 4: Convert `search_data` to CSV text output

**Files:**
- Modify: `src/mcp-servers/datasets/tools/search-data.ts` (text formatting)
- Modify: `src/mcp-servers/datasets/tools.test.ts` (update test assertions)

- [ ] **Step 1: Update the tests to assert on structuredContent + text format**

In `src/mcp-servers/datasets/tools.test.ts`, update all `search_data` tests. The key changes:
- Replace `JSON.parse((result.content as any)[0].text)` with `result.structuredContent as any`
- Add text format assertions where relevant

Replace the first test:

```typescript
  it('should search data with query and return results with filtered view URL', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('q'), 'ACME')
      assert.equal(url.searchParams.get('q_mode'), 'complete')
      assert.equal(url.searchParams.get('size'), '10')
      return {
        total: 5,
        results: [{ _id: 'abc', _i: 1, _rand: 123, nom: 'ACME', ville: 'Paris', _score: 1.5 }]
      }
    }

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', query: 'ACME' }
    })

    // Verify structuredContent
    const sc = result.structuredContent as any
    assert.equal(sc.datasetId, 'ds1')
    assert.equal(sc.count, 5)
    assert.equal(sc.lines.length, 1)
    assert.equal(sc.lines[0].nom, 'ACME')
    assert.equal(sc.lines[0]._id, undefined)
    assert.equal(sc.lines[0]._i, undefined)
    assert.equal(sc.lines[0]._rand, undefined)
    assert.equal(sc.lines[0]._score, 1.5)
    assert.ok(sc.filteredViewUrl.includes('/datasets/ds1/full'))
    assert.ok(sc.filteredViewUrl.includes('q=ACME'))

    // Verify text format
    const text = (result.content as any)[0].text
    assert.ok(text.includes('1 results (5 total)'))
    assert.ok(text.includes('Filtered view:'))
    assert.ok(text.includes('ACME,Paris'))
    assert.ok(text.includes('nom,ville,_score'))  // _score column present when query used
    assert.ok(!text.startsWith('{'))
  })
```

For remaining tests, replace `JSON.parse(...)` with `result.structuredContent as any`:

```typescript
  it('should search data with filters', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('ville_eq'), 'Paris')
      return { total: 1, results: [{ nom: 'ACME', ville: 'Paris' }] }
    }

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', filters: { ville_eq: 'Paris' } }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.count, 1)

    // When no query is used, _score should not appear in text
    const text = (result.content as any)[0].text
    assert.ok(!text.includes('_score'))
  })
```

```typescript
  it('should return next URL when API provides one', async () => {
    routes['/datasets/ds1/lines'] = (url) => ({
      total: 25,
      results: [{ nom: 'ACME', ville: 'Paris' }],
      next: 'http://localhost/data-fair/api/v1/datasets/ds1/lines?size=10&after=abc123'
    })

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', query: 'ACME' }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.next, 'http://localhost/data-fair/api/v1/datasets/ds1/lines?size=10&after=abc123')

    const text = (result.content as any)[0].text
    assert.ok(text.includes('Next page available.'))
  })

  it('should not include next when API does not provide one', async () => {
    routes['/datasets/ds1/lines'] = (url) => ({
      total: 1,
      results: [{ nom: 'ACME', ville: 'Paris' }]
    })

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', query: 'ACME' }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.next, undefined)

    const text = (result.content as any)[0].text
    assert.ok(!text.includes('Next page available.'))
  })
```

```typescript
  it('should fetch directly from next URL when provided', async () => {
    const addr = fakeApi.address() as import('node:net').AddressInfo
    const nextUrl = `http://localhost:${addr.port}/data-fair/api/v1/datasets/ds1/lines?size=10&after=abc123`

    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('after'), 'abc123')
      return {
        total: 25,
        results: [{ nom: 'Globex', ville: 'Lyon' }]
      }
    }

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', next: nextUrl }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.lines[0].nom, 'Globex')
    assert.equal(sc.count, 25)
  })

  it('should pass sort parameter', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.equal(url.searchParams.get('sort'), 'population,-name')
      return { total: 2, results: [{ nom: 'A' }, { nom: 'B' }] }
    }

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', sort: 'population,-name' }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.count, 2)
    assert.ok(sc.filteredViewUrl.includes('sort=population'))
  })

  it('should pass select parameter', async () => {
    routes['/datasets/ds1/lines'] = (url) => {
      assert.ok(url.searchParams.get('select')?.includes('nom'))
      return { total: 1, results: [{ nom: 'ACME' }] }
    }

    const result = await client.callTool({
      name: 'search_data',
      arguments: { datasetId: 'ds1', query: 'test', select: 'nom,ville' }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.lines.length, 1)
  })
```

The `pass custom size` and `cap size at 50` tests don't assert on content, so they stay unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern='search_data' src/mcp-servers/datasets/tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Update search-data.ts text output**

In `src/mcp-servers/datasets/tools/search-data.ts`, update the import:
```typescript
import { getOrigin, buildAxiosOptions, encodeDatasetId, filtersSchema, handleApiError, toCSV, formatTextOutput } from './_utils.ts'
```

Replace the return block (lines 119-127) with:

```typescript
      const resultCount = structuredContent.lines.length
      const csvData = toCSV(structuredContent.lines).trimEnd()

      const headerBlock = [
        `${resultCount} results (${structuredContent.count} total)`,
        `Filtered view: ${structuredContent.filteredViewUrl}`
      ].join('\n')

      const sections = [headerBlock, csvData]

      if (structuredContent.next) {
        sections.push('Next page available.')
      }

      const text = formatTextOutput(sections)

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-name-pattern='search_data' src/mcp-servers/datasets/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-servers/datasets/tools/search-data.ts src/mcp-servers/datasets/tools.test.ts
git commit -m "feat: convert search_data text output to CSV"
```

---

### Task 5: Convert `calculate_metric` to plain text output

**Files:**
- Modify: `src/mcp-servers/datasets/tools/calculate-metric.ts` (text formatting)
- Modify: `src/mcp-servers/datasets/tools.test.ts` (update test assertions)

- [ ] **Step 1: Update the tests**

In `src/mcp-servers/datasets/tools.test.ts`, update `calculate_metric` tests:

```typescript
describe('calculate_metric', () => {
  it('should calculate a metric on a column', async () => {
    routes['/datasets/ds1/metric_agg'] = (url) => {
      assert.equal(url.searchParams.get('metric'), 'avg')
      assert.equal(url.searchParams.get('field'), 'salaire')
      return { total: 1000, metric: 42500 }
    }

    const result = await client.callTool({
      name: 'calculate_metric',
      arguments: { datasetId: 'ds1', fieldKey: 'salaire', metric: 'avg' }
    })
    const sc = result.structuredContent as any

    assert.equal(sc.datasetId, 'ds1')
    assert.equal(sc.fieldKey, 'salaire')
    assert.equal(sc.metric, 'avg')
    assert.equal(sc.total, 1000)
    assert.equal(sc.value, 42500)

    const text = (result.content as any)[0].text
    assert.ok(text.includes('Metric: avg of "salaire"'))
    assert.ok(text.includes('Dataset: ds1'))
    assert.ok(text.includes('Total rows: 1000'))
    assert.ok(text.includes('Result: 42500'))
    assert.ok(!text.startsWith('{'))
  })

  it('should format stats metric as key=value pairs', async () => {
    routes['/datasets/ds1/metric_agg'] = (url) => {
      assert.equal(url.searchParams.get('metric'), 'stats')
      return { total: 1000, metric: { count: 1000, min: 18000, max: 120000, avg: 48500, sum: 48500000 } }
    }

    const result = await client.callTool({
      name: 'calculate_metric',
      arguments: { datasetId: 'ds1', fieldKey: 'salaire', metric: 'stats' }
    })
    const text = (result.content as any)[0].text
    assert.ok(text.includes('count=1000'))
    assert.ok(text.includes('min=18000'))
    assert.ok(text.includes('avg=48500'))
  })

  it('should pass filters and percents', async () => {
    routes['/datasets/ds1/metric_agg'] = (url) => {
      assert.ok(url.searchParams.get('percents')?.includes('25'))
      assert.equal(url.searchParams.get('ville_eq'), 'Paris')
      return { total: 500, metric: { 25: 30000, 50: 42000, 75: 55000 } }
    }

    const result = await client.callTool({
      name: 'calculate_metric',
      arguments: {
        datasetId: 'ds1',
        fieldKey: 'salaire',
        metric: 'percentiles',
        percents: '25,50,75',
        filters: { ville_eq: 'Paris' }
      }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.value['50'], 42000)

    const text = (result.content as any)[0].text
    assert.ok(text.includes('25%=30000'))
    assert.ok(text.includes('50%=42000'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern='calculate_metric' src/mcp-servers/datasets/tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Update calculate-metric.ts text output**

In `src/mcp-servers/datasets/tools/calculate-metric.ts`, replace the return block:

```typescript
      let resultStr: string
      if (params.metric === 'stats' && typeof structuredContent.value === 'object' && structuredContent.value !== null) {
        resultStr = Object.entries(structuredContent.value).map(([k, v]) => `${k}=${v}`).join(', ')
      } else if (params.metric === 'percentiles' && typeof structuredContent.value === 'object' && structuredContent.value !== null) {
        resultStr = Object.entries(structuredContent.value).map(([k, v]) => `${k}%=${v}`).join(', ')
      } else {
        resultStr = String(structuredContent.value)
      }

      const text = [
        `Metric: ${params.metric} of "${params.fieldKey}"`,
        `Dataset: ${params.datasetId}`,
        `Total rows: ${structuredContent.total}`,
        `Result: ${resultStr}`
      ].join('\n')

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-name-pattern='calculate_metric' src/mcp-servers/datasets/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-servers/datasets/tools/calculate-metric.ts src/mcp-servers/datasets/tools.test.ts
git commit -m "feat: convert calculate_metric text output to plain text"
```

---

### Task 6: Convert `get_field_values` to newline-separated text output

**Files:**
- Modify: `src/mcp-servers/datasets/tools/get-field-values.ts` (text formatting)
- Modify: `src/mcp-servers/datasets/tools.test.ts` (update test assertions)

- [ ] **Step 1: Update the tests**

In `src/mcp-servers/datasets/tools.test.ts`, update `get_field_values` tests:

```typescript
describe('get_field_values', () => {
  it('should return distinct values for a column', async () => {
    routes['/datasets/ds1/values/ville'] = (url) => {
      assert.equal(url.searchParams.get('size'), '10')
      return ['Paris', 'Lyon', 'Marseille']
    }

    const result = await client.callTool({
      name: 'get_field_values',
      arguments: { datasetId: 'ds1', fieldKey: 'ville' }
    })
    const sc = result.structuredContent as any

    assert.equal(sc.datasetId, 'ds1')
    assert.equal(sc.fieldKey, 'ville')
    assert.deepEqual(sc.values, ['Paris', 'Lyon', 'Marseille'])

    const text = (result.content as any)[0].text
    assert.ok(text.includes('Distinct values of "ville" in dataset ds1:'))
    assert.ok(text.includes('Paris'))
    assert.ok(text.includes('Lyon'))
    assert.ok(text.includes('Marseille'))
    assert.ok(!text.startsWith('{'))
  })

  it('should pass optional parameters', async () => {
    routes['/datasets/ds1/values/ville'] = (url) => {
      assert.equal(url.searchParams.get('q'), 'Ly')
      assert.equal(url.searchParams.get('sort'), 'desc')
      assert.equal(url.searchParams.get('size'), '5')
      return ['Lyon']
    }

    const result = await client.callTool({
      name: 'get_field_values',
      arguments: { datasetId: 'ds1', fieldKey: 'ville', query: 'Ly', sort: 'desc', size: 5 }
    })
    const sc = result.structuredContent as any
    assert.deepEqual(sc.values, ['Lyon'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern='get_field_values' src/mcp-servers/datasets/tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Update get-field-values.ts text output**

In `src/mcp-servers/datasets/tools/get-field-values.ts`, replace the return block:

```typescript
      const text = `Distinct values of "${params.fieldKey}" in dataset ${params.datasetId}:\n${structuredContent.values.join('\n')}`

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-name-pattern='get_field_values' src/mcp-servers/datasets/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-servers/datasets/tools/get-field-values.ts src/mcp-servers/datasets/tools.test.ts
git commit -m "feat: convert get_field_values text output to newline-separated list"
```

---

### Task 7: Convert `aggregate_data` to indented tree text output

**Files:**
- Modify: `src/mcp-servers/datasets/tools/aggregate-data.ts` (text formatting)
- Modify: `src/mcp-servers/datasets/tools.test.ts` (update test assertions)

- [ ] **Step 1: Update the tests**

In `src/mcp-servers/datasets/tools.test.ts`, update all `aggregate_data` tests:

```typescript
describe('aggregate_data', () => {
  it('should aggregate data by columns', async () => {
    routes['/datasets/ds1/values_agg'] = (url) => {
      assert.equal(url.searchParams.get('field'), 'ville')
      return {
        total: 100,
        total_values: 3,
        total_other: 10,
        aggs: [
          { value: 'Paris', total: 50, total_values: 1, total_other: 0, metric: null },
          { value: 'Lyon', total: 30, total_values: 1, total_other: 0, metric: null },
          { value: 'Marseille', total: 20, total_values: 1, total_other: 0, metric: null }
        ]
      }
    }

    const result = await client.callTool({
      name: 'aggregate_data',
      arguments: { datasetId: 'ds1', groupByColumns: ['ville'] }
    })
    const sc = result.structuredContent as any

    assert.equal(sc.total, 100)
    assert.equal(sc.totalAggregated, 3)
    assert.equal(sc.nonRepresented, 10)
    assert.equal(sc.aggregations.length, 3)
    assert.equal(sc.aggregations[0].columnValue, 'Paris')
    assert.equal(sc.aggregations[0].total, 50)

    const text = (result.content as any)[0].text
    assert.ok(text.includes('Total: 100 rows'))
    assert.ok(text.includes('Groups shown: 3'))
    assert.ok(text.includes('Rows not shown: 10'))
    assert.ok(text.includes('- Paris: 50 rows'))
    assert.ok(text.includes('- Lyon: 30 rows'))
    assert.ok(!text.startsWith('{'))
  })

  it('should aggregate with a metric', async () => {
    routes['/datasets/ds1/values_agg'] = (url) => {
      assert.equal(url.searchParams.get('metric'), 'avg')
      assert.equal(url.searchParams.get('metric_field'), 'salaire')
      return {
        total: 100,
        total_values: 2,
        total_other: 0,
        aggs: [
          { value: 'Paris', total: 50, total_values: 1, total_other: 0, metric: 45000 },
          { value: 'Lyon', total: 30, total_values: 1, total_other: 0, metric: 38000 }
        ]
      }
    }

    const result = await client.callTool({
      name: 'aggregate_data',
      arguments: {
        datasetId: 'ds1',
        groupByColumns: ['ville'],
        metric: { column: 'salaire', type: 'avg' }
      }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.aggregations[0].metricValue, 45000)

    const text = (result.content as any)[0].text
    assert.ok(text.includes('- Paris: 50 rows, avg salaire = 45000'))
  })

  it('should support nested aggregations', async () => {
    routes['/datasets/ds1/values_agg'] = (url) => {
      assert.equal(url.searchParams.get('field'), 'ville;contrat')
      return {
        total: 100,
        total_values: 2,
        total_other: 0,
        aggs: [{
          value: 'Paris',
          total: 50,
          total_values: 2,
          total_other: 0,
          metric: null,
          aggs: [
            { value: 'CDI', total: 30, total_values: 1, total_other: 0, metric: null },
            { value: 'CDD', total: 20, total_values: 1, total_other: 0, metric: null }
          ]
        }]
      }
    }

    const result = await client.callTool({
      name: 'aggregate_data',
      arguments: { datasetId: 'ds1', groupByColumns: ['ville', 'contrat'] }
    })
    const sc = result.structuredContent as any
    assert.equal(sc.aggregations[0].aggregations.length, 2)
    assert.equal(sc.aggregations[0].aggregations[0].columnValue, 'CDI')

    const text = (result.content as any)[0].text
    assert.ok(text.includes('- Paris: 50 rows'))
    assert.ok(text.includes('  - CDI: 30 rows'))
    assert.ok(text.includes('  - CDD: 20 rows'))
  })
```

The `sort` and `count metric` tests don't assert on content — just update `JSON.parse` to `structuredContent` if needed (they don't parse content currently, so no changes needed).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern='aggregate_data' src/mcp-servers/datasets/tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Update aggregate-data.ts text output**

In `src/mcp-servers/datasets/tools/aggregate-data.ts`, update the import:
```typescript
import { getOrigin, buildAxiosOptions, encodeDatasetId, filtersSchema, handleApiError, formatTextOutput } from './_utils.ts'
```

Replace the return block with:

```typescript
      const formatAggLine = (agg: any, metric: typeof params.metric, indent: string): string => {
        let line = `${indent}- ${agg.columnValue}: ${agg.total} rows`
        if (metric && metric.type !== 'count' && agg.metricValue != null) {
          line += `, ${metric.type} ${metric.column} = ${agg.metricValue}`
        }
        if (agg.aggregations) {
          for (const sub of agg.aggregations) {
            line += '\n' + formatAggLine(sub, metric, indent + '  ')
          }
        }
        return line
      }

      const aggLines = structuredContent.aggregations
        .map((agg: any) => formatAggLine(agg, params.metric, ''))
        .join('\n')

      const headerBlock = [
        `Aggregation on dataset ${params.datasetId}`,
        `Total: ${structuredContent.total} rows | Groups shown: ${structuredContent.totalAggregated} | Rows not shown: ${structuredContent.nonRepresented}`,
        `API URL: ${structuredContent.requestUrl}`
      ].join('\n')

      const text = formatTextOutput([headerBlock, aggLines])

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-name-pattern='aggregate_data' src/mcp-servers/datasets/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-servers/datasets/tools/aggregate-data.ts src/mcp-servers/datasets/tools.test.ts
git commit -m "feat: convert aggregate_data text output to indented tree"
```

---

### Task 8: Run full test suite and verify quality

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: No errors.

- [ ] **Step 3: Run type check**

```bash
npm run check-types
```

Expected: No errors.

- [ ] **Step 4: Fix any issues found and commit**

If issues are found, fix them and commit with an appropriate message.
