# Contract Verification API (Express)

This is a Node.js and Express implementation of the contract verification API. It is intentionally separate from the existing PHP service in `backend/`; the PHP files are not required or modified. It keeps the same endpoints used by the React app: `GET /versions`, `GET /contract`, and `POST /verify`.

The API compiles submitted Solidity source with configured `solc` executables, reads deployed runtime bytecode from the supplied JSON-RPC node, and saves sources only after a bytecode match. Verified source, compiler settings, and ABI are stored in MySQL. No Solidity library is used by this backend.

## Requirements

- Node.js 20 or newer
- MySQL 5.7.8 or newer (MySQL 8 recommended)
- One or more `solc` executables matching the compiler versions used for deployments
- An RPC node reachable from this API server

## Configure and run

From this folder, install dependencies and create the database table:

```sh
npm install
mysql -u root -p < schema.sql
```

Set environment variables in the same shell used to start the API. Use the exact Solidity compiler version used to deploy the contract:

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
npm start
```

The service listens on `http://127.0.0.1:8081`, which matches the React app's default verifier URL. `SOLC_BINARY` is required as the default compiler. `SOLC_BINARIES` is optional and maps additional exact semantic compiler versions to executable paths. The API checks each compiler's reported version before returning it from `/versions` or using it to verify source.

Optional settings: `PORT` (default `8081`), `MAX_REQUEST_BYTES` (default `1100000`), and `COMPILE_TIMEOUT_SECONDS` (default `45`).

## API behavior

`GET /versions` lists installed compiler versions and the default. `POST /verify` accepts the source bundle and compiler options used by the React verification form; it returns `verified: true` only after runtime bytecode matches. `GET /contract?address=0x...&rpcUrl=...` returns saved source only when the current chain ID, address, and deployed bytecode hash match.

RPC hosts and browser origins are restricted by `ALLOWED_RPC_HOSTS` and `ALLOWED_ORIGINS`. Configure exact allowed hostnames and browser origins; do not use `*` for RPC hosts. CORS is not authentication. Add authentication, rate limiting, and abuse controls before exposing this API publicly. Do not expose an unauthenticated local Hardhat RPC to the internet.