#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Anthropic from "@anthropic-ai/sdk";

const EXTRACTION_PROMPT = `You are evaluating documentation for a tool or library. Your job is to extract what you understand from it and rate your confidence.

Read the documentation below and extract:

1. **capability**: What does this tool do? (1-2 sentences)
2. **inputs**: What does it take as input? (list)
3. **outputs**: What does it return? (list)
4. **when_to_use**: When should an agent use this? (list of scenarios)
5. **when_not_to_use**: When should an agent NOT use this? (list)
6. **constraints**: Limitations, requirements, gotchas (list)
7. **invocation**: How do you call it? (code examples if available)

For each dimension, rate your confidence from 0.0 to 1.0:
- 1.0 = Completely clear, no ambiguity
- 0.7 = Mostly clear, minor gaps
- 0.5 = Partially clear, significant assumptions required  
- 0.3 = Unclear, mostly guessing
- 0.0 = No information available

Finally, list any **gaps** - things you wanted to know but couldn't find, or areas where the documentation was confusing.

Respond ONLY with valid JSON in this exact format:
{
  "extraction": {
    "capability": "string",
    "inputs": ["string"],
    "outputs": ["string"],
    "when_to_use": ["string"],
    "when_not_to_use": ["string"],
    "constraints": ["string"],
    "invocation": "string or null"
  },
  "confidence": {
    "capability": 0.0,
    "inputs": 0.0,
    "outputs": 0.0,
    "when_to_use": 0.0,
    "when_not_to_use": 0.0,
    "constraints": 0.0,
    "invocation": 0.0
  },
  "gaps": ["string"],
  "overall_confidence": 0.0
}

Documentation to evaluate:
`;

class DoclintServer {
  constructor() {
    this.server = new Server(
      {
        name: "doclint",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.anthropic = new Anthropic();
    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "lint",
          description:
            "Extracts structured understanding from documentation. Returns what an agent understood, confidence scores for each dimension, and gaps in the documentation.",
          inputSchema: {
            type: "object",
            properties: {
              content: {
                type: "string",
                description: "The documentation content (README, manifest, etc.)",
              },
              name: {
                type: "string",
                description: "Name of the tool/library being documented (optional)",
              },
            },
            required: ["content"],
          },
        },
        {
          name: "compare",
          description:
            "Compares extracted understanding against intended understanding. Returns alignment score and specific mismatches.",
          inputSchema: {
            type: "object",
            properties: {
              extracted: {
                type: "object",
                description: "The extraction result from the lint tool",
              },
              intended: {
                type: "object",
                description: "What you intended the documentation to convey",
              },
            },
            required: ["extracted", "intended"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === "lint") {
        return await this.handleLint(args);
      } else if (name === "compare") {
        return await this.handleCompare(args);
      }

      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    });
  }

  async handleLint(args) {
    const { content, name } = args;

    try {
      const message = await this.anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: EXTRACTION_PROMPT + content,
          },
        ],
      });

      const responseText = message.content[0].text;
      
      // Parse the JSON response
      let extraction;
      try {
        extraction = JSON.parse(responseText);
      } catch (parseError) {
        // Try to extract JSON from the response if it has extra text
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extraction = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Could not parse extraction response as JSON");
        }
      }

      // Add metadata
      extraction.tool_name = name || "unknown";
      extraction.evaluated_at = new Date().toISOString();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(extraction, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error during extraction: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  async handleCompare(args) {
    const { extracted, intended } = args;

    const mismatches = [];
    let alignmentScore = 0;
    let totalDimensions = 0;

    const dimensions = [
      "capability",
      "inputs",
      "outputs",
      "when_to_use",
      "when_not_to_use",
      "constraints",
    ];

    for (const dim of dimensions) {
      totalDimensions++;
      const ext = extracted.extraction?.[dim];
      const int = intended[dim];

      if (!ext && !int) {
        alignmentScore++;
        continue;
      }

      if (!ext || !int) {
        mismatches.push({
          dimension: dim,
          issue: !ext ? "missing_in_extraction" : "missing_in_intended",
          extracted: ext || null,
          intended: int || null,
        });
        continue;
      }

      // Simple similarity check - in production this would be smarter
      const extStr = JSON.stringify(ext).toLowerCase();
      const intStr = JSON.stringify(int).toLowerCase();

      // Check for key term overlap
      const extTerms = new Set(extStr.match(/\b\w{4,}\b/g) || []);
      const intTerms = new Set(intStr.match(/\b\w{4,}\b/g) || []);

      const intersection = [...extTerms].filter((t) => intTerms.has(t));
      const union = new Set([...extTerms, ...intTerms]);

      const similarity = union.size > 0 ? intersection.length / union.size : 0;

      if (similarity > 0.5) {
        alignmentScore++;
      } else {
        mismatches.push({
          dimension: dim,
          issue: "mismatch",
          similarity: similarity.toFixed(2),
          extracted: ext,
          intended: int,
        });
      }
    }

    const result = {
      alignment_score: (alignmentScore / totalDimensions).toFixed(2),
      aligned_dimensions: alignmentScore,
      total_dimensions: totalDimensions,
      mismatches,
      recommendation:
        mismatches.length === 0
          ? "Documentation aligns well with intent"
          : `Review these dimensions: ${mismatches.map((m) => m.dimension).join(", ")}`,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("doclint MCP server running on stdio");
  }
}

const server = new DoclintServer();
server.run().catch(console.error);
