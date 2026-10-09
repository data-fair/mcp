# Live test of the data-fair MCP server

You are testing the data-fair MCP server as a user of its tools, not developing it. The
development instructions of the parent repository do not apply in this directory: do not read or
change the server's code, and do not run its build or tests. Everything goes through the `datafair`
MCP server configured here (the published Docker image, reaching the platform through nhi-proxy
with the identity of a non-human identity).

When asked to run the live test, follow the protocol below in order, then write the report.

## Rules

- Read-only by default. If tools that create, modify or delete are exposed (profiles `write`,
  `manage`…), list them but call one only after the user explicitly agreed to that call.
- Do not work around a failing tool with another channel (curl, web fetch…): the failure is the
  finding.
- Keep calls small (page sizes of a few items) — this is a check, not an analysis.

## Protocol

### 1. Availability

- The `datafair` MCP server is connected. If not, stop and report the client's error.
- Read the server instructions and list the tools. With the default profiles (`catalog,read`),
  expect at least (as of this writing):
  `datafair_list_datasets`, `datafair_describe_dataset`, `datafair_search_data`,
  `datafair_get_field_values`, `datafair_aggregate_data`, `datafair_calculate_metric`,
  `datafair_list_account_datasets`, `datafair_list_account_applications`,
  `datafair_describe_application`, `metrics_aggregate_requests`, `geocode_address`.
  Report missing and unexpected tools. Tool names must be unique.
- List the MCP resources: expect the skills `skill://data-fair/workflow/SKILL.md` and
  `skill://metrics/metrics-review/SKILL.md`. Read both.

### 2. Identity

- Call `datafair_list_account_datasets`. It must list the NHI's account datasets. Report the
  account it reveals (owner of the results). An authentication error or an unexpectedly empty
  list means the identity is not reaching the APIs — report it and skip step 4.

### 3. Catalog

Following the `workflow` skill: find a dataset with `datafair_list_datasets`, describe it, then on
that dataset search rows, get the values of one field, aggregate on one field and calculate one
metric. Check the results are consistent with each other (counts, field names from the schema).

### 4. Account

- `datafair_list_account_applications`, then `datafair_describe_application` on one of them.
- Following the `metrics-review` skill: with `metrics_aggregate_requests`, the account's requests
  over the last 30 days, split by resource.

### 5. Other tools

- `geocode_address` on one French address.
- Any tool not covered above: one representative read-only call each.

### 6. Quality

For every tool used, note whether its description and parameters were enough to call it right the
first time, and whether errors (if any) told you how to recover.

## Report

Write it to `reports/<YYYY-MM-DD-HHmm>.md` and summarize it in the chat:

- context: platform, profiles, image tag (from `.env`), the account
  revealed in step 2;
- a table: tool | called | outcome (ok / error / unexpected) | notes;
- missing or unexpected tools and resources;
- issues found, most severe first, each with the call that shows it (tool, arguments, response
  excerpt);
- suggestions on descriptions, skills or tool shapes.
