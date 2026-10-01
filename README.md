# Blockchain UI

A standalone React + Vite address inspector for the local Hardhat blockchain. This project has its own dependencies and configuration inside `blockchain ui/`; it does not use the sibling `ui/` app or Solidity package.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To make a production bundle, run `npm run build`.

## Connect to local Hardhat

Start the local chain from the separate Solidity project:

```sh
cd ../solidity
npm run node
```

Then run this app with its default RPC URL, `http://127.0.0.1:8545`. The home page scans recent blocks and lists all transactions found, 10 at a time. Search an address to see its native/token balances and filter the ledger to transactions where it is sender or recipient. Selecting a row opens a deep-linked transaction detail page with status, block, time, value, gas, nonce, calldata, and receipt token transfers.

ERC-20/BEP-20-compatible token contracts are discovered from `Transfer` logs in the scanned range and their balances are read with `balanceOf`. You can also manually add a token contract address to check a token that had no transfers in that range. The scan depth is configurable (maximum 20,000 blocks); a token with no matching transfer in the scanned range must be added manually. Local Hardhat has no built-in explorer, so external explorer links are optional.

The app is read-only: it does not request wallet access, signatures, or send transactions. The local RPC receives the searched address and requested block range.
