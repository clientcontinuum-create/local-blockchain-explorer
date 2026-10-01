import crypto from "node:crypto";
import { spawn } from "node:child_process";
import express from "express";
import mysql from "mysql2/promise";

const app = express();
const port = Number(process.env.PORT || 8081);
const maxRequestBytes = Number(process.env.MAX_REQUEST_BYTES || 1_100_000);
const compileTimeoutMs = Number(process.env.COMPILE_TIMEOUT_SECONDS || 45) * 1000;
const allowedOrigins = csvEnv("ALLOWED_ORIGINS", ["http://localhost:5173", "http://127.0.0.1:5173"]);
const allowedRpcHosts = csvEnv("ALLOWED_RPC_HOSTS", ["localhost", "127.0.0.1", "::1"]);
const solcBinaries = loadSolcBinaries();
let databasePool;

function csvEnv(name, fallback) {
  const value = process.env[name];
  return (value ? value.split(",") : fallback).map((part) => part.trim().toLowerCase()).filter(Boolean);
}

function loadSolcBinaries() {
  const binaries = new Map();
  if (process.env.SOLC_BINARIES) {
    let configured;
    try {
      configured = JSON.parse(process.env.SOLC_BINARIES);
    } catch {
      throw new Error("SOLC_BINARIES must be valid JSON mapping compiler versions to executable paths.");
    }
    if (!configured || Array.isArray(configured) || typeof configured !== "object" || Object.keys(configured).length > 30) {
      throw new Error("SOLC_BINARIES must be a JSON object with at most 30 compiler entries.");
    }
    for (const [version, binary] of Object.entries(configured)) {
      if (!/^\d+\.\d+\.\d+$/.test(version) || typeof binary !== "string" || !binary.trim()) {
        throw new Error("Each SOLC_BINARIES entry must map a semantic version to an executable path.");
      }
      binaries.set(version, binary.trim());
    }
  }
  return { binaries, defaultBinary: process.env.SOLC_BINARY || "solc" };
}

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function respondError(error, res) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status === 500) console.error("Contract verifier error:", error);
  res.status(status).json({ error: status === 500 ? "Backend configuration or database error. Check the Node server log." : error.message });
}

function database() {
  if (databasePool) return databasePool;
  const { DB_HOST = "127.0.0.1", DB_PORT = "3306", DB_NAME, DB_USER, DB_PASSWORD = "" } = process.env;
  if (!DB_NAME || !DB_USER) throw apiError(500, "Database configuration is incomplete.");
  databasePool = mysql.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 5,
    charset: "utf8mb4",
  });
  return databasePool;
}

function validateAddress(value) {
  if (typeof value !== "string" || !/^0x[a-f\d]{40}$/i.test(value)) throw apiError(400, "A valid EVM contract address is required.");
  return value.toLowerCase();
}

function validateRpcUrl(value) {
  if (typeof value !== "string" || value.length > 2048) throw apiError(400, "A valid RPC URL is required.");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw apiError(400, "RPC URL must be an HTTP(S) URL without embedded credentials.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw apiError(400, "RPC URL must be an HTTP(S) URL without embedded credentials.");
  }
  if (!allowedRpcHosts.includes(parsed.hostname.toLowerCase())) throw apiError(403, "This RPC host is not allowed by the backend. Add it to ALLOWED_RPC_HOSTS.");
  return parsed.toString();
}

async function rpcCall(url, method, params) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch (error) {
    console.error("RPC request failed:", error.message);
    throw apiError(502, "Could not read contract data from the configured RPC.");
  }
  if (!response.ok) throw apiError(502, "Could not read contract data from the configured RPC.");
  const text = await response.text();
  if (text.length > 2_000_000) throw apiError(502, "The RPC response is too large.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw apiError(502, "The RPC returned an invalid response.");
  }
  if (!data || data.error || !Object.hasOwn(data, "result")) throw apiError(502, "The RPC returned an invalid response.");
  return data.result;
}

async function readDeployment(rpcUrl, address) {
  const url = validateRpcUrl(rpcUrl);
  const [chainIdValue, code] = await Promise.all([
    rpcCall(url, "eth_chainId", []),
    rpcCall(url, "eth_getCode", [address, "latest"]),
  ]);
  if (typeof chainIdValue !== "string" || !/^0x[\da-f]+$/i.test(chainIdValue) || typeof code !== "string" || !/^0x(?:[\da-f]{2})+$/i.test(code)) {
    throw apiError(404, "No deployed contract bytecode was found at that address.");
  }
  const chainId = `0x${BigInt(chainIdValue).toString(16)}`;
  const normalizedCode = code.toLowerCase();
  const deployedHash = crypto.createHash("sha256").update(Buffer.from(normalizedCode.slice(2), "hex")).digest("hex");
  return { chainId, code: normalizedCode, deployedHash };
}

function compilerVersion(binary) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", () => reject(apiError(503, "Solidity compiler is unavailable on the backend.")));
    child.on("close", (code) => {
      const version = stdout.match(/Version:\s*(\d+\.\d+\.\d+)/)?.[1];
      if (code !== 0 || !version) {
        console.error("Could not read solc version:", stderr);
        reject(apiError(503, "Could not determine the backend Solidity compiler version."));
      } else resolve(version);
    });
  });
}

async function compilerRegistry() {
  const entries = new Map(solcBinaries.binaries);
  for (const [version, binary] of entries) {
    const actual = await compilerVersion(binary);
    if (actual !== version) throw apiError(500, `Configured solc binary for ${version} reports version ${actual}.`);
  }
  const defaultVersion = await compilerVersion(solcBinaries.defaultBinary);
  if (!entries.has(defaultVersion)) entries.set(defaultVersion, solcBinaries.defaultBinary);
  const sorted = [...entries].sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
  return { entries: new Map(sorted), defaultVersion };
}

function validateSources(sources) {
  if (!sources || typeof sources !== "object" || Array.isArray(sources) || Object.keys(sources).length < 1 || Object.keys(sources).length > 40) {
    throw apiError(400, "Submit between 1 and 40 Solidity source files.");
  }
  const validated = {};
  let totalBytes = 0;
  for (const [path, content] of Object.entries(sources)) {
    if (!path || path.includes("\\") || path.startsWith("/") || path.split("/").includes("..") || !path.toLowerCase().endsWith(".sol") || typeof content !== "string") {
      throw apiError(400, "Source paths must be relative .sol file paths with no parent-directory segments.");
    }
    totalBytes += Buffer.byteLength(content, "utf8");
    validated[path] = { content };
  }
  if (totalBytes > 1_000_000) throw apiError(413, "Total Solidity source size must not exceed 1 MB.");
  return validated;
}

function runCompiler(binary, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["--standard-json"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, compileTimeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", () => {
      clearTimeout(timeout);
      reject(apiError(503, "Could not start the Solidity compiler."));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) return reject(apiError(408, "Compilation exceeded the backend time limit."));
      if (code !== 0) {
        console.error("solc failed:", stderr);
        return reject(apiError(422, "Solidity compilation failed. Check the source files and compiler settings."));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(apiError(422, "The compiler returned invalid output."));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

async function compileContract(input, version, binary) {
  if (input.compilerVersion !== version) throw apiError(422, `Requested compiler version does not match the backend compiler (${version}).`);
  const sources = validateSources(input.sources);
  const { contractFile, contractName } = input;
  if (typeof contractFile !== "string" || !Object.hasOwn(sources, contractFile) || typeof contractName !== "string" || !/^[A-Za-z_$][A-Za-z\d_$]*$/.test(contractName)) {
    throw apiError(400, "Choose a contract file and contract name from the submitted source.");
  }
  const optimizer = input.optimizer && typeof input.optimizer === "object" ? input.optimizer : {};
  const optimizerEnabled = optimizer.enabled === true;
  const optimizerRuns = Number(optimizer.runs ?? 200);
  if (!Number.isInteger(optimizerRuns) || optimizerRuns < 1 || optimizerRuns > 1_000_000) throw apiError(400, "Optimizer runs must be between 1 and 1000000.");
  const settings = {
    optimizer: { enabled: optimizerEnabled, runs: optimizerRuns },
    outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences", "evm.deployedBytecode.linkReferences"] } },
  };
  if (Object.hasOwn(input, "viaIR")) settings.viaIR = input.viaIR === true;
  if (input.evmVersion !== undefined && input.evmVersion !== "") {
    if (typeof input.evmVersion !== "string" || !/^[a-z\d]+$/.test(input.evmVersion)) throw apiError(400, "Invalid EVM version.");
    settings.evmVersion = input.evmVersion;
  }
  if (input.metadataBytecodeHash !== undefined) {
    if (!["ipfs", "bzzr1", "none"].includes(input.metadataBytecodeHash)) throw apiError(400, "Metadata bytecode hash must be ipfs, bzzr1, or none.");
    settings.metadata = { bytecodeHash: input.metadataBytecodeHash };
  }
  const output = await runCompiler(binary, { language: "Solidity", sources, settings });
  const errors = (output.errors || []).filter((item) => item.severity === "error");
  if (errors.length) throw apiError(422, errors.slice(0, 5).map((item) => item.formattedMessage || item.message || "Compilation error").join("\n"));
  const contract = output.contracts?.[contractFile]?.[contractName];
  const runtime = contract?.evm?.deployedBytecode?.object;
  if (typeof runtime !== "string" || !runtime) throw apiError(422, "The selected contract has no deployable runtime bytecode.");
  if (Object.keys(contract.evm.deployedBytecode.linkReferences || {}).length) throw apiError(422, "Contracts with external library links are not supported by this verifier yet.");
  return {
    name: contractName,
    file: contractFile,
    runtime: runtime.toLowerCase(),
    immutableReferences: contract.evm.deployedBytecode.immutableReferences || {},
    abi: contract.abi || [],
    sources: Object.fromEntries(Object.entries(sources).map(([path, source]) => [path, source.content])),
    settings,
  };
}

function bytecodeMatches(compiled, deployed, immutableReferences) {
  if (!/^[\da-f]+$/.test(compiled) || compiled.length !== deployed.length) return false;
  const mask = new Array(compiled.length / 2).fill(false);
  for (const references of Object.values(immutableReferences)) {
    for (const reference of references) {
      const { start, length } = reference;
      if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 1 || start + length > mask.length) return false;
      for (let index = start; index < start + length; index += 1) mask[index] = true;
    }
  }
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] && compiled.slice(index * 2, index * 2 + 2) !== deployed.slice(index * 2, index * 2 + 2)) return false;
  }
  return true;
}

function stripSolidityMetadata(bytecode) {
  if (bytecode.length < 8 || bytecode.length % 2 !== 0 || !/^[\da-f]+$/.test(bytecode)) return bytecode;
  const byteLength = bytecode.length / 2;
  const metadataLength = Number.parseInt(bytecode.slice(-4), 16);
  const metadataStart = byteLength - metadataLength - 2;
  if (metadataLength < 4 || metadataStart < 0) return bytecode;
  const metadata = bytecode.slice(metadataStart * 2, metadataStart * 2 + metadataLength * 2);
  if (!/^(?:a1|a2|a3)(?:64(?:69706673|736f6c63)|65(?:627a7a7231))/.test(metadata)) return bytecode;
  return bytecode.slice(0, metadataStart * 2);
}

app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.get("origin");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (origin) {
    if (!allowedOrigins.includes("*") && !allowedOrigins.includes(origin.toLowerCase())) return res.status(403).json({ error: "This browser origin is not allowed by the backend." });
    res.set("Access-Control-Allow-Origin", allowedOrigins.includes("*") ? "*" : origin);
    res.vary("Origin");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: maxRequestBytes, strict: true }));
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get("/versions", async (req, res) => {
  try {
    const { entries, defaultVersion } = await compilerRegistry();
    res.json({ versions: [...entries.keys()], defaultVersion });
  } catch (error) {
    respondError(error, res);
  }
});

app.post("/verify", async (req, res) => {
  try {
    if (!req.body || Array.isArray(req.body) || typeof req.body !== "object") throw apiError(400, "Request body must be a JSON object.");
    const input = req.body;
    const address = validateAddress(input.address);
    const { chainId, code, deployedHash } = await readDeployment(input.rpcUrl, address);
    const { entries } = await compilerRegistry();
    if (typeof input.compilerVersion !== "string" || !entries.has(input.compilerVersion)) throw apiError(422, "Selected Solidity compiler version is not installed or configured on this backend.");
    const compiled = await compileContract(input, input.compilerVersion, entries.get(input.compilerVersion));
    const deployed = code.slice(2);
    if (!bytecodeMatches(compiled.runtime, deployed, compiled.immutableReferences)) {
      const message = stripSolidityMetadata(compiled.runtime) === stripSolidityMetadata(deployed)
        ? "Executable bytecode matches, but Solidity metadata differs. Check the original source file path, exact source files, compiler version, EVM target, optimizer, viaIR, and metadata hash settings."
        : "The compiled executable bytecode does not match the contract deployed at this address. Check that the source and compiler settings belong to this exact deployment.";
      throw apiError(422, message);
    }
    await database().execute(
      "INSERT INTO verified_contracts (chain_id, contract_address, deployed_code_hash, contract_name, source_files, compiler_version, compiler_settings, abi) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE contract_name = VALUES(contract_name), source_files = VALUES(source_files), compiler_version = VALUES(compiler_version), compiler_settings = VALUES(compiler_settings), abi = VALUES(abi), created_at = CURRENT_TIMESTAMP",
      [chainId, address, deployedHash, compiled.name, JSON.stringify(compiled.sources), input.compilerVersion, JSON.stringify(compiled.settings), JSON.stringify(compiled.abi)],
    );
    res.status(201).json({ verified: true, chainId, address, bytecodeHash: deployedHash, contractName: compiled.name });
  } catch (error) {
    respondError(error, res);
  }
});

app.get("/contract", async (req, res) => {
  try {
    const address = validateAddress(req.query.address);
    const { chainId, deployedHash } = await readDeployment(req.query.rpcUrl, address);
    const [rows] = await database().execute(
      "SELECT contract_name, source_files, compiler_version, compiler_settings, abi, created_at FROM verified_contracts WHERE chain_id = ? AND contract_address = ? AND deployed_code_hash = ? LIMIT 1",
      [chainId, address, deployedHash],
    );
    const contract = rows[0];
    if (!contract) return res.status(404).json({ verified: false, error: "No matching verified source was found for this deployment." });
    res.json({
      verified: true,
      chainId,
      address,
      bytecodeHash: deployedHash,
      contractName: contract.contract_name,
      sources: typeof contract.source_files === "string" ? JSON.parse(contract.source_files) : contract.source_files,
      compilerVersion: contract.compiler_version,
      compilerSettings: typeof contract.compiler_settings === "string" ? JSON.parse(contract.compiler_settings) : contract.compiler_settings,
      abi: typeof contract.abi === "string" ? JSON.parse(contract.abi) : contract.abi,
      verifiedAt: contract.created_at,
    });
  } catch (error) {
    respondError(error, res);
  }
});

app.use((req, res) => res.status(404).json({ error: "Unknown endpoint. Use POST /verify or GET /contract." }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === "entity.too.large") return res.status(413).json({ error: "Request is too large." });
  if (error instanceof SyntaxError && "body" in error) return res.status(400).json({ error: "Request body must be a JSON object." });
  respondError(error, res);
});

app.listen(port, "127.0.0.1", () => console.log(`Contract verifier API listening at http://127.0.0.1:${port}`));