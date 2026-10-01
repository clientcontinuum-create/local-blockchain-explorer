# Local Hardhat Chain

This folder is a self-contained Hardhat project for running a local JSON-RPC blockchain for the Blockchain UI explorer. Its Node.js dependencies, configuration, and generated Hardhat files are kept inside this folder; it does not depend on a sibling Solidity project.

It also includes `LocalBEP20.sol`, a minimal BEP-20-compatible token contract implemented without imported contract libraries. It mints a fixed supply of 1,000,000 tokens (18 decimals) to the deployer and supports transfers, approvals, and delegated transfers.

## Requirements

- Node.js 22.13 or newer
- npm

## Start the node

From this folder, install dependencies and start the local chain:

```sh
npm install
npm run node
```

The node listens at `http://127.0.0.1:8545`, matching the explorer's default RPC URL. Keep this terminal running while using the app. Press `Ctrl+C` to stop the node. Hardhat provides funded development accounts; do not use their private keys or this local chain for real funds.

## Deploy the sample token

With the node running, open another terminal in this folder and run:

```sh
npm run deploy
```

The script compiles the contract, deploys it using a local unlocked Hardhat account, and prints its address. It refuses to deploy unless the RPC endpoint reports local chain ID `31337`. The contract uses no third-party Solidity libraries; `ethers` is used only by the deployment script.

## Compile contracts

Place Solidity source files in `contracts/`, then run:

```sh
npm run compile
```