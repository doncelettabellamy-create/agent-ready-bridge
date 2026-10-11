"use strict";

// Agent-Ready Bridge local data engine.
// Implements GET /api/fetch-records exactly as described in openapi.yaml.
// No dependencies: runs on Node.js 18+ with the built-in http module.
//
//   API_KEY=your-secret node server.js
//
// Environment:
//   API_KEY  required. Requests must send it in the X-API-Key header.
//   PORT     optional, default 3000.
//   HOST     optional, default 127.0.0.1 (local only).

const http = require("node:http");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error("API_KEY is not set. Refusing to start without an access key.");
  process.exit(1);
}

// Mock client log. dataType is the format the client's source files are kept in.
const CLIENT_LOG = [
  { clientName: "Maple Street Bakery", totalStaffHoursLost: 14, dataType: "csv" },
  { clientName: "Brightside Dental", totalStaffHoursLost: 22.5, dataType: "json" },
  { clientName: "Harbor Auto Repair", totalStaffHoursLost: 9, dataType: "text" },
  { clientName: "Maple Street Bakery", totalStaffHoursLost: 6, dataType: "json" },
  { clientName: "Riverside Community Pantry", totalStaffHoursLost: 31, dataType: "csv" },
];

const OUTPUT_FORMATS = ["json", "csv", "text"];

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(payload);
}

const sendError = (res, status, message, headers) =>
  sendJson(res, status, { status: "error", message }, headers);

function keyIsValid(provided) {
  if (typeof provided !== "string" || provided.length === 0) return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(API_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}

const csvCell = (value) => `"${String(value).replace(/"/g, '""')}"`;

function formatRecords(records, dataType) {
  if (dataType === "csv") {
    return records.map((r) => [r.clientName, r.totalStaffHoursLost, r.dataType].map(csvCell).join(","));
  }
  if (dataType === "text") {
    return records.map(
      (r) => `${r.clientName}: ${r.totalStaffHoursLost} staff hours lost (source data: ${r.dataType})`
    );
  }
  return records.map((r) => ({ ...r }));
}

// Validates query parameters against openapi.yaml. Returns { error } or { value }.
function parseQuery(params) {
  const clientName = (params.get("clientName") || "").trim();
  if (!clientName) return { error: "clientName is required." };
  if (clientName.length > 200) return { error: "clientName must be 200 characters or fewer." };

  let totalStaffHoursLost;
  if (params.has("totalStaffHoursLost")) {
    const raw = params.get("totalStaffHoursLost").trim();
    totalStaffHoursLost = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(totalStaffHoursLost) || totalStaffHoursLost < 0) {
      return { error: "totalStaffHoursLost must be a number of 0 or more." };
    }
  }

  const dataType = params.has("dataType") ? params.get("dataType") : "json";
  if (!OUTPUT_FORMATS.includes(dataType)) {
    return { error: `dataType must be one of: ${OUTPUT_FORMATS.join(", ")}.` };
  }

  return { value: { clientName, totalStaffHoursLost, dataType } };
}

function handleFetchRecords(req, res, url) {
  if (!keyIsValid(req.headers["x-api-key"])) {
    return sendError(res, 401, "Missing or invalid API key.", { "WWW-Authenticate": "ApiKey" });
  }

  const parsed = parseQuery(url.searchParams);
  if (parsed.error) return sendError(res, 400, parsed.error);
  const { clientName, totalStaffHoursLost, dataType } = parsed.value;

  const matches = CLIENT_LOG.filter(
    (r) =>
      r.clientName.toLowerCase() === clientName.toLowerCase() &&
      (totalStaffHoursLost === undefined || r.totalStaffHoursLost >= totalStaffHoursLost)
  );

  const body = { status: "ok", readOnly: true, clientName };
  if (totalStaffHoursLost !== undefined) body.totalStaffHoursLost = totalStaffHoursLost;
  body.dataType = dataType;
  body.recordCount = matches.length;
  body.records = formatRecords(matches, dataType);
  return sendJson(res, 200, body);
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    return sendError(res, 400, "Malformed request URL.");
  }

  if (url.pathname !== "/api/fetch-records") return sendError(res, 404, "Not found.");
  if (req.method !== "GET") return sendError(res, 405, "Only GET is allowed.", { Allow: "GET" });

  try {
    return handleFetchRecords(req, res, url);
  } catch (err) {
    console.error("Unhandled error:", err);
    return sendError(res, 500, "Internal server error.");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Agent-Ready Bridge engine listening on http://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
