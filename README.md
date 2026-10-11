# Agent-Ready Bridge

A small, dependency-light [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that gives AI assistants safe, read-only access to a small business's existing data, without migrating databases or rewriting software.

## Why it exists

Most small businesses run on legacy setups: spreadsheets exported to CSV, an old accounting system, a point-of-sale database dumped nightly. AI assistants can't reach any of it. Making that data "agent-ready" usually means a costly integration project.

Agent-Ready Bridge closes that gap with one small step:

1. Export or sync your legacy data to a JSON file (most systems can already do this).
2. Point the bridge at the file.
3. Connect it to an MCP-capable assistant such as Claude Desktop or Claude Code. Other clients that support MCP, including ChatGPT where MCP connectors are available, can use it the same way.

Your assistant can then answer questions like *"Which orders are still open?"* or *"Show me inactive customers in Tampa"* from live business data.

## What you get

- **Read-only by design.** The server never writes to your data file.
- **Local-first.** Data stays on your machine. The server talks to the assistant over stdio and makes no network calls.
- **Bounded responses.** Results are capped (default 50, maximum 200 records) so large files don't overwhelm the assistant.
- **Clear errors.** Missing files, invalid JSON, and unknown collections return readable messages the assistant can act on.

## Tool

### `fetch_business_data`

| Parameter    | Type                        | Description                                                              |
| ------------ | --------------------------- | ------------------------------------------------------------------------ |
| `collection` | string (optional)           | Collection name, e.g. `customers`. Omit to list all collections.         |
| `filters`    | object (optional)           | Exact-match, case-insensitive field/value pairs, e.g. `{"status":"open"}`. |
| `limit`      | integer 1–200 (optional)    | Maximum records to return. Default 50.                                   |

Example response for `collection: "orders"`, `filters: {"status": "open"}`:

```json
{
  "collection": "orders",
  "total_matches": 2,
  "returned": 2,
  "records": [
    { "id": 1002, "customer_id": 2, "total": 980, "status": "open" },
    { "id": 1003, "customer_id": 1, "total": 75.25, "status": "open" }
  ]
}
```

## Data format

The data file is a JSON object. Each key is a collection, and each value is an array of records:

```json
{
  "customers": [{ "id": 1, "name": "Maple Street Bakery", "status": "active" }],
  "orders": [{ "id": 1001, "customer_id": 1, "total": 240.5, "status": "paid" }]
}
```

A sample file with appointments (`clientName`, `appointmentTime`, `serviceType`, `status`) is included at `database.json`.

## Setup

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

By default the server reads `database.json` in the project folder. To use your own file, set `BUSINESS_DATA_PATH`:

```bash
# macOS / Linux
BUSINESS_DATA_PATH=/path/to/my-data.json npm start

# Windows PowerShell
$env:BUSINESS_DATA_PATH = "C:\path\to\my-data.json"; npm start
```

## Connect to Claude

Add the server to your MCP client configuration (for Claude Desktop, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agent-ready-bridge": {
      "command": "node",
      "args": ["C:\\path\\to\\agent-ready-bridge\\index.js"],
      "env": { "BUSINESS_DATA_PATH": "C:\\path\\to\\my-data.json" }
    }
  }
}
```

For Claude Code:

```bash
claude mcp add agent-ready-bridge -e BUSINESS_DATA_PATH=/path/to/my-data.json -- node /path/to/agent-ready-bridge/index.js
```

Other MCP-compatible clients, including ChatGPT where it supports MCP connectors, use the same command and arguments. Check your client's documentation for where to register a local stdio server.

## Security notes

- The file path is set by the operator through `BUSINESS_DATA_PATH`. Assistants cannot choose which file is read.
- Only expose data you are comfortable sharing with the assistant. Remove sensitive fields (payment details, personal identifiers) from the exported JSON.
- Logs go to stderr so they never interfere with the protocol on stdout.

## License

MIT
