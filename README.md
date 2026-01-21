# doclint

Extracts structured understanding from documentation. Returns what an agent understood, confidence scores, and gaps.

## Overview

Doclint is an MCP server for agents that reads documentation and extracts a structured summary (capability, inputs/outputs, constraints) with confidence scores and gaps, so you can verify tool docs are agent-parseable and aligned with intent.

## Interface

```
INPUT:  documentation content (string)
OUTPUT: { extraction, confidence, gaps, overall_confidence }
```

## Tools

| Tool | Description |
|------|-------------|
| `lint` | Extract understanding from docs, return confidence scores |
| `compare` | Compare extracted understanding against intended understanding |

## lint

Reads documentation and extracts:

| Dimension | Description |
|-----------|-------------|
| capability | What the tool does (1-2 sentences) |
| inputs | What it takes as input |
| outputs | What it returns |
| when_to_use | Scenarios where it's appropriate |
| when_not_to_use | Scenarios to avoid |
| constraints | Limitations, requirements, gotchas |
| invocation | How to call it |

Each dimension gets a confidence score from 0.0 to 1.0:

| Score | Meaning |
|-------|---------|
| 1.0 | Completely clear, no ambiguity |
| 0.7 | Mostly clear, minor gaps |
| 0.5 | Partially clear, significant assumptions required |
| 0.3 | Unclear, mostly guessing |
| 0.0 | No information available |

**Example output:**

```json
{
  "extraction": {
    "capability": "Validates JSON against a schema",
    "inputs": ["schema (JSON Schema)", "data (any JSON)"],
    "outputs": ["validation result", "coerced result"],
    "when_to_use": ["validating LLM outputs", "fixing malformed JSON"],
    "when_not_to_use": ["dynamic schemas", "non-JSON data"],
    "constraints": ["10MB max", "draft-07 only"],
    "invocation": "schemachek validate --schema s.json --data d.json"
  },
  "confidence": {
    "capability": 0.95,
    "inputs": 0.90,
    "outputs": 0.85,
    "when_to_use": 0.80,
    "when_not_to_use": 0.75,
    "constraints": 0.90,
    "invocation": 0.95
  },
  "gaps": [
    "Unclear how nested object coercion works",
    "No example of array validation"
  ],
  "overall_confidence": 0.87
}
```

## compare

Compares extracted understanding against what you intended.

**Input:**
```json
{
  "extracted": { "extraction": { ... }, "confidence": { ... } },
  "intended": {
    "capability": "what you meant it to say",
    "inputs": ["what you meant"],
    "outputs": ["what you meant"]
  }
}
```

**Output:**
```json
{
  "alignment_score": "0.85",
  "aligned_dimensions": 5,
  "total_dimensions": 6,
  "mismatches": [
    {
      "dimension": "constraints",
      "issue": "mismatch",
      "extracted": ["10MB max"],
      "intended": ["10MB max", "no streaming support"]
    }
  ],
  "recommendation": "Review these dimensions: constraints"
}
```

## Constraints

- Requires `ANTHROPIC_API_KEY` environment variable
- Uses claude-sonnet-4-20250514
- Non-deterministic (LLM-based extraction)
- No side effects

## Invocation (MCP)

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "doclint": {
      "command": "node",
      "args": ["/path/to/doclint/src/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your-key"
      }
    }
  }
}
```

## When to Use

- Verify documentation is agent-parseable before publishing
- Find gaps in tool documentation
- Pre-flight check before using unfamiliar tools
- Compare author intent vs reader understanding

## When Not to Use

- Human-only documentation (marketing, tutorials)
- Documentation without structured tool/API information
- When you need deterministic output

## Source

https://github.com/acoyfellow/doclint
