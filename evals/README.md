# LLM-in-the-Loop Evaluation System

This evaluation system tests the data-fair MCP tools by having Claude Code answer natural language questions using the tools against the real `opendata.koumoul.com` instance.

## Prerequisites

The data-fair MCP server must be configured in Claude Code, pointing to `https://opendata.koumoul.com`. No API key is needed for this public instance.

## How it works

1. Scenarios are defined in `scenarios.json` — each has a question (in French) and expected behavior
2. A master prompt spawns one subagent per scenario
3. Each subagent uses the data-fair MCP tools to answer its question
4. The master agent judges each answer as pass/fail with a rationale
5. A summary table is produced at the end

## Running the eval

Open Claude Code in this project directory, then paste the following master prompt:

---

**Master prompt — copy everything below this line:**

```
Read the file evals/scenarios.json. This contains evaluation scenarios for the data-fair MCP tools. For each scenario, do the following:

1. Spawn a subagent (using the Agent tool) with this prompt:

   "You have access to data-fair MCP tools that query opendata.koumoul.com. Answer the following question using these tools. Be concise. Before giving your final answer, list each tool you called and summarize what it returned.

   Question: {scenario.question}"

2. Wait for the subagent to complete, then judge its answer against the "expected" field from the scenario. Determine pass or fail based on:
   - Did it use the appropriate MCP tools (not just guess)?
   - Does the answer contain the kind of information described in "expected"?
   - Did it avoid hallucinating data?

3. Record: scenario id, pass/fail, one-line rationale.

Run scenarios SEQUENTIALLY (one at a time) to avoid rate limiting.

After all scenarios complete, output a summary table:

| Scenario ID | Result | Rationale |
|---|---|---|
| ... | ... | ... |

Then output: total passed / total scenarios.
```

---

## Adding scenarios

Edit `scenarios.json` to add new entries. Each scenario needs:

- `id` — short kebab-case identifier
- `question` — natural language question in French
- `expected` — description of what a correct answer looks like (used by the judge)

## Interpreting results

- **Pass**: The subagent used appropriate tools and produced an answer matching the expected behavior
- **Fail**: The subagent missed tools, hallucinated data, errored out, or produced an irrelevant answer

Failures may indicate:
- Tool descriptions need improvement
- The MCP server has a bug
- The scenario's expected behavior is too strict
- Rate limiting or connectivity issues
