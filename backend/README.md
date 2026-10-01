# Contract verification backend

This standalone PHP API compiles submitted Solidity source with the configured `solc`, fetches the contract bytecode from the supplied JSON-RPC endpoint, and stores source only when compiled runtime bytecode matches. It does not need an explorer API key. It supports Solidity source bundles and immutable constructor values; external library-linked contracts are rejected rather than incorrectly marked verified.

## Requirements

- PHP 8.1+ with `curl`, `pdo_mysql`, and `proc_open` enabled
- MySQL 5.7.8+ (MySQL 8 recommended)
- One or more `solc` executables matching the compiler versions used for deployments
- An RPC node reachable from the PHP server

## Configure and run locally

Create the database and table:

```sh
mysql -u root -p < backend/schema.sql
```

Set the environment for the PHP process. Use the exact Solidity compiler version used to deploy the contract:

```sh
export DB_HOST=127.0.0.1
export DB_PORT=3306
export DB_NAME=contract_verifier
export DB_USER=your_mysql_user
export DB_PASSWORD=your_mysql_password
export SOLC_BINARY=/absolute/path/to/solc
export SOLC_BINARIES='{"0.8.25":"/absolute/path/to/solc-0.8.25","0.8.24":"/absolute/path/to/solc-0.8.24"}'
export ALLOWED_ORIGINS=http://localhost:5173,https://example.com
export ALLOWED_RPC_HOSTS=localhost,127.0.0.1,::1
php -S 127.0.0.1:8081 -t backend backend/router.php
```

For Apache, enable `mod_rewrite` and serve this directory with the included `.htaccess`. Set environment variables in the PHP-FPM/Apache service configuration, not in a file served to the browser.

## API

`POST /verify` accepts JSON. `sources` is an object mapping Solidity file paths to complete source text. All imported source files must be included in the submission.

```json
{
  "rpcUrl": "http://127.0.0.1:8545",
  "address": "0x0000000000000000000000000000000000000001",
  "compilerVersion": "0.8.25",
  "contractFile": "contracts/Example.sol",
  "contractName": "Example",
  "optimizer": { "enabled": true, "runs": 200 },
  "viaIR": false,
  "sources": {
    "contracts/Example.sol": "// SPDX-License-Identifier: MIT\npragma solidity 0.8.25;\ncontract Example {}"
  }
}
```

Optional compiler settings are `evmVersion` and `metadataBytecodeHash` (`ipfs`, `bzzr1`, or `none`). `GET /versions` returns the compiler versions available to the browser form. `SOLC_BINARIES` is a JSON object mapping exact semantic versions to executable compiler paths; the backend checks each binary's reported version before advertising or using it. `SOLC_BINARY` remains the default and is included automatically if it is not already in the map. Install each compiler executable on the PHP server and configure its path. The API responds with `verified: true` only after a bytecode match.

`GET /contract?address=0x...&rpcUrl=http%3A%2F%2F127.0.0.1%3A8545` returns source and compiler data only when the current chain ID, address, and deployed bytecode hash match a saved verification.

## RPC and deployment notes

The PHP server itself makes the JSON-RPC request. A hosted PHP server cannot reach a visitor's `localhost`; allowlisting `127.0.0.1` means the PHP server's own loopback. For a user's private local chain, run this PHP backend on the same machine as that chain, or change the design so the browser submits bytecode and the backend clearly labels the result as client-attested rather than independently verified. Do not expose an unauthenticated local Hardhat RPC to the public internet.

Set `ALLOWED_RPC_HOSTS` to a comma-separated exact hostname allowlist. This is an SSRF guard; do not use `*`. Set `ALLOWED_ORIGINS` to the exact browser origins that may call the API. CORS is not authentication: add rate limiting and abuse controls before exposing verification submissions publicly. The API limits request size, source count, source size, and compile duration.

The backend files are intentionally self-contained under `backend/`; this change does not wire the React UI to these endpoints.