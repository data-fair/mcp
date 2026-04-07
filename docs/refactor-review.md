# Refactor review: shared agent-tools extraction

Review of the refactor extracting tool logic into `@data-fair/agent-tools-data-fair`.

## Quality concerns

### search_data: filteredViewUrl sort not normalized (potential bug)

Old code applied `normalizeSort()` to the sort param for both the API call and the filtered view URL. New code delegates API sort normalization to `buildQuery`, but the filtered view URL uses raw `params.sort`. If an LLM passes `sort: "_geo_distance"` (without coordinates), the filtered view URL will contain the invalid sort while the API call correctly strips it.

### list_datasets.formatResult iterates data.results twice

In the shared package `list-datasets.ts`, `data.results` is iterated once with `data.results ?? []` (safe) and once more with `data.results.map(...)` (would throw if undefined). Minor inconsistency.

### describe_dataset: sampleLines non-null assertion

`describeTool.formatResult(fetchedData, { sampleLines: sampleLines! })` uses a non-null assertion. The old code had `sampleLines ?? []` as a safety net in case `handleApiError` somehow doesn't throw.
