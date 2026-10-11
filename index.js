#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const DATA_FILE = path.resolve(
  process.env.BUSINESS_DATA_PATH || path.join(__dirname, "database.json")
);
const MAX_LIMIT = 200;

// stdout is reserved for the MCP protocol; all diagnostics go to stderr.
const log = (...args) => console.error("[agent-ready-bridge]", ...args);

async function loadData() {
  let raw;
  try {
    raw = await fs.readFile(DATA_FILE, "utf8");
  } catch (err) {
    throw new Error(`Cannot read data file (${err.code || err.message}).`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Data file is not valid JSON: ${err.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Data file must be a JSON object whose keys are collections (e.g. customers, orders).");
  }
  return parsed;
}

function matches(record, filters) {
  return Object.entries(filters).every(([field, expected]) => {
    const actual = record?.[field];
    if (actual === undefined || actual === null) return false;
    return String(actual).toLowerCase() === String(expected).toLowerCase();
  });
}

const server = new McpServer({ name: "agent-ready-bridge", version: "1.0.0" });

server.registerTool(
  "fetch_business_data",
  {
    title: "Fetch Business Data",
    description:
      "Read records from the business's local JSON data file. Call without a collection to list available collections. " +
      "Provide a collection to retrieve its records, optionally narrowed by exact-match (case-insensitive) filters.",
    inputSchema: {
      collection: z
        .string()
        .min(1)
        .optional()
        .describe("Collection name, e.g. 'customers' or 'orders'. Omit to list all collections."),
      filters: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe("Field/value pairs a record must match exactly, e.g. { \"status\": \"open\" }."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_LIMIT)
        .optional()
        .describe(`Maximum records to return (default 50, max ${MAX_LIMIT}).`),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ collection, filters, limit }) => {
    try {
      const data = await loadData();

      if (!collection) {
        const summary = Object.entries(data).map(([name, value]) => ({
          collection: name,
          records: Array.isArray(value) ? value.length : 1,
        }));
        return { content: [{ type: "text", text: JSON.stringify({ collections: summary }, null, 2) }] };
      }

      if (!Object.prototype.hasOwnProperty.call(data, collection)) {
        const available = Object.keys(data).join(", ") || "(none)";
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown collection "${collection}". Available: ${available}.` }],
        };
      }

      const value = data[collection];
      const records = Array.isArray(value) ? value : [value];
      const filtered = filters && Object.keys(filters).length ? records.filter((r) => matches(r, filters)) : records;
      const max = limit ?? 50;
      const result = {
        collection,
        total_matches: filtered.length,
        returned: Math.min(filtered.length, max),
        records: filtered.slice(0, max),
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      log("fetch_business_data failed:", err.message);
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }
);

async function main() {
  await server.connect(new StdioServerTransport());
  log(`running on stdio, data file: ${DATA_FILE}`);
}

main().catch((err) => {
  log("fatal:", err);
  process.exit(1);
});
