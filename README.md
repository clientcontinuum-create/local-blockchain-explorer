# LOCAL BLOCKCHAIN EXPLORER

A standalone React + Vite address inspector for the local Hardhat blockchain.

## About this project

Blockchain UI is a lightweight, read-only blockchain explorer for inspecting activity on a local Hardhat network. It reads data from the configured JSON-RPC endpoint and presents recent transactions, address balances, token activity, and transaction details in a browser. It is intended for local development and learning, and does not require a wallet connection or expose controls for signing or sending transactions.

This project is a good fit for developers learning EVM chains or testing smart contracts who want a simple way to inspect local accounts, transactions, and token activity. It may not meet your needs if you are looking for a production-grade public explorer, broad multi-chain indexing, or wallet and transaction-submission features; this app is intentionally read-only and geared toward a local Hardhat network.

## Use cases

- Inspect transactions created while developing or testing smart contracts.
- Check an account's native currency and ERC-20/BEP-20-compatible token balances and activity.
- Review transaction status, gas, calldata, and receipt token transfers when debugging.
- Demonstrate blockchain and token activity in a local environment without relying on an external explorer.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To make a production bundle, run `npm run build`.

## Connect to local Hardhat

The Hardhat node is a separate, self-contained project in this repository's `solidity/` folder. In one terminal, from the repository root, install its dependencies and start the node:

```sh
cd solidity
npm install
npm run node
```

With the node still running, open another terminal, enter `solidity/`, and deploy the sample BEP-20-compatible token:

```sh
cd solidity
npm run deploy
```

Then, in a separate terminal at the repository root, start the app with `npm install` and `npm run dev` if you have not already done so. The app connects to the node at `http://127.0.0.1:8545` by default. The home page scans recent blocks and lists all transactions found, 10 at a time. Search an address to see its native/token balances and filter the ledger to transactions where it is sender or recipient. Selecting a row opens a deep-linked transaction detail page with status, block, time, value, gas, nonce, calldata, and receipt token transfers. Stop the local chain with `Ctrl+C` when finished.

ERC-20/BEP-20-compatible token contracts are discovered from `Transfer` logs in the scanned range and their balances are read with `balanceOf`. You can also manually add a token contract address to check a token that had no transfers in that range. The scan depth is configurable (maximum 20,000 blocks); a token with no matching transfer in the scanned range must be added manually. Local Hardhat has no built-in explorer, so external explorer links are optional.

The app is read-only: it does not request wallet access, signatures, or send transactions. The local RPC receives the searched address and requested block range.

## Contract verification API

To enable the Contract tab's source verification features, start the separate Express API in `nodejsbackend/`. Follow [its setup guide](nodejsbackend/README.md) to configure MySQL and Solidity compiler binaries. The API uses `http://127.0.0.1:8081` by default, matching the app's verifier URL setting. The existing PHP service in `backend/` is kept separate and unchanged.
