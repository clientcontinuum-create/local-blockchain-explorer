import { useEffect, useRef, useState } from "react";
import { Activity, ArrowDownLeft, ArrowLeft, ArrowUpRight, Blocks, Check, ChevronDown, CircleAlert, Clock3, Copy, ExternalLink, Fingerprint, LoaderCircle, Moon, RefreshCw, Search, Settings2, Sun, Wallet, X } from "lucide-react";
import { Contract, formatEther, formatUnits, id, isAddress, JsonRpcProvider, zeroPadValue } from "ethers";
import HomePage from "./pages/HomePage.jsx";
import AddressPage from "./pages/AddressPage.jsx";
import TokenPage from "./pages/TokenPage.jsx";
import "./local.css";

const TRANSFER_TOPIC = id("Transfer(address,address,uint256)").toLowerCase();
const TRANSACTIONS_PER_PAGE = 10;
const defaults = {
  rpcUrl: import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545",
  scanDepth: Number(import.meta.env.VITE_SCAN_DEPTH || 5000),
  explorerUrl: import.meta.env.VITE_EXPLORER_URL || "",
  verifierUrl: import.meta.env.VITE_VERIFIER_API_URL || "http://127.0.0.1:8081",
};
const saved = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem("blockscope-settings") || "{}");
    return {
      ...defaults,
      ...stored,
      rpcUrl: stored.rpcUrl === "https://ethereum-rpc.publicnode.com" ? defaults.rpcUrl : (stored.rpcUrl || defaults.rpcUrl),
      scanDepth: Number(stored.scanDepth || defaults.scanDepth),
      verifierUrl: stored.verifierUrl || defaults.verifierUrl,
    };
  }
  catch { return defaults; }
})();

function shortAddress(value = "") {
  return value ? `${value.slice(0, 8)}...${value.slice(-6)}` : "Unknown";
}

function formatDate(value) {
  if (!value) return "Pending";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function transactionMethod(input = "0x", to = "") {
  if (!to) return "Contract Creation";
  const selector = input.slice(0, 10).toLowerCase();
  const methods = {
    "0x095ea7b3": "Approve",
    "0xa9059cbb": "Transfer",
    "0x23b872dd": "Transfer From",
    "0x70a08231": "Balance Of",
    "0x18160ddd": "Total Supply",
    "0x06fdde03": "Name",
    "0x95d89b41": "Symbol",
  };
  return input === "0x" ? "Native Transfer" : methods[selector] || `Function ${selector}`;
}

function timeAgo(value) {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - Math.floor(new Date(value).getTime() / 1000));
  if (elapsed < 60) return `${elapsed} sec ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)} min ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)} hr ago`;
  return `${Math.floor(elapsed / 86400)} days ago`;
}

function txStatus(tx) {
  const value = String(tx.status || tx.result || "").toLowerCase();
  if (value.includes("error") || value.includes("fail")) return "Failed";
  if (value.includes("pending") || tx.block === null || tx.block === undefined) return "Pending";
  return "Success";
}

function nativeValue(value, symbol = "ETH") {
  try { return `${Number(formatEther(BigInt(value || "0"))).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol}`; }
  catch { return `0 ${symbol}`; }
}

function nativeSymbol(chainId) {
  if (chainId === "56" || chainId === "97") return "BNB";
  if (chainId === "137" || chainId === "80002") return "MATIC";
  return "ETH";
}

function erc20Transfer(log) {
  if (log.topics.length < 3 || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return null;
  try {
    return {
      token: log.address,
      from: `0x${log.topics[1].slice(-40)}`,
      to: `0x${log.topics[2].slice(-40)}`,
      rawAmount: BigInt(log.data),
    };
  } catch {
    return null;
  }
}

async function loadTokenBalances(provider, address, firstBlock, latestBlock, manualTokenAddresses = []) {
  const addressTopic = zeroPadValue(address, 32);
  const tokenAddresses = new Map(manualTokenAddresses.filter(isAddress).map((token) => [token.toLowerCase(), token]));
  const transferLogs = [];

  for (let fromBlock = firstBlock; fromBlock <= latestBlock; fromBlock += 500) {
    const toBlock = Math.min(latestBlock, fromBlock + 499);
    const [sentLogs, receivedLogs] = await Promise.all([
      provider.getLogs({ fromBlock, toBlock, topics: [TRANSFER_TOPIC, addressTopic] }),
      provider.getLogs({ fromBlock, toBlock, topics: [TRANSFER_TOPIC, null, addressTopic] }),
    ]);
    for (const log of [...sentLogs, ...receivedLogs]) {
      tokenAddresses.set(log.address.toLowerCase(), log.address);
      transferLogs.push(erc20Transfer(log));
    }
  }

  const tokenAbi = [
    "function name() view returns(string)",
    "function symbol() view returns(string)",
    "function decimals() view returns(uint8)",
    "function balanceOf(address) view returns(uint256)",
  ];
  const tokens = await Promise.all([...tokenAddresses.values()].map(async (tokenAddress) => {
    const token = new Contract(tokenAddress, tokenAbi, provider);
    const [name, symbol, decimals, balance] = await Promise.all([
      token.name().catch(() => "Unknown token"),
      token.symbol().catch(() => "TOKEN"),
      token.decimals().catch(() => 18n),
      token.balanceOf(address),
    ]);
    const decimalCount = Number(decimals);
    return {
      address: tokenAddress,
      name,
      symbol,
      decimals: decimalCount,
      rawBalance: balance.toString(),
      balance: formatUnits(balance, decimalCount),
    };
  }));

  const tokenByAddress = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));
  const relevantTransfers = transferLogs.filter(Boolean).filter((transfer) =>
    transfer.from.toLowerCase() === address.toLowerCase() || transfer.to.toLowerCase() === address.toLowerCase());
  return { tokens, relevantTransfers, tokenByAddress };
}

async function tokenMetadata(provider, tokenAddress) {
  const token = new Contract(tokenAddress, ["function name() view returns(string)", "function symbol() view returns(string)", "function decimals() view returns(uint8)"], provider);
  const [name, symbol, decimals] = await Promise.all([
    token.name().catch(() => "Unknown token"),
    token.symbol().catch(() => "TOKEN"),
    token.decimals().catch(() => 18n),
  ]);
  return { name, symbol, decimals: Number(decimals) };
}

async function detectTokenContract(provider, tokenAddress) {
  if (await provider.getCode(tokenAddress) === "0x") return null;
  const token = new Contract(tokenAddress, [
    "function name() view returns(string)",
    "function symbol() view returns(string)",
    "function decimals() view returns(uint8)",
    "function totalSupply() view returns(uint256)",
  ], provider);
  try {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      token.name(), token.symbol(), token.decimals(), token.totalSupply(),
    ]);
    return { name, symbol, decimals: Number(decimals), totalSupply: totalSupply.toString() };
  } catch {
    return null;
  }
}

async function loadTokenPageData(provider, tokenAddress, scanDepth, coinSymbol) {
  const [latestBlock, token] = await Promise.all([
    provider.getBlockNumber(),
    detectTokenContract(provider, tokenAddress),
  ]);
  if (!token) throw new Error("This address is not a readable ERC-20/BEP-20 token contract.");
  const firstBlock = Math.max(0, latestBlock - scanDepth + 1);
  const logs = [];
  for (let fromBlock = firstBlock; fromBlock <= latestBlock; fromBlock += 500) {
    const toBlock = Math.min(latestBlock, fromBlock + 499);
    logs.push(...await provider.getLogs({ address: tokenAddress, fromBlock, toBlock, topics: [TRANSFER_TOPIC] }));
  }
  logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

  const candidateHolders = new Set();
  for (const log of logs) {
    const transfer = erc20Transfer(log);
    if (!transfer) continue;
    if (transfer.from !== "0x0000000000000000000000000000000000000000") candidateHolders.add(transfer.from);
    if (transfer.to !== "0x0000000000000000000000000000000000000000") candidateHolders.add(transfer.to);
  }
  const holderList = [...candidateHolders];
  let holderCursor = 0;
  let holderCount = 0;
  async function countHolders() {
    const contract = new Contract(tokenAddress, ["function balanceOf(address) view returns(uint256)"], provider);
    while (holderCursor < holderList.length) {
      const holder = holderList[holderCursor++];
      try { if (await contract.balanceOf(holder) > 0n) holderCount += 1; } catch { /* Ignore nonstandard tokens. */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, holderList.length) }, countHolders));

  let creator = "";
  let blockCursor = latestBlock;
  async function findCreator() {
    while (!creator && blockCursor >= firstBlock) {
      const blockNumber = blockCursor--;
      const block = await provider.getBlock(blockNumber, true);
      if (!block) continue;
      for (const transaction of block.prefetchedTransactions) {
        if (transaction.to) continue;
        const receipt = await provider.getTransactionReceipt(transaction.hash);
        if (receipt?.contractAddress?.toLowerCase() === tokenAddress.toLowerCase()) {
          creator = transaction.from;
          return;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, latestBlock - firstBlock + 1) }, findCreator));

  const transactionCache = new Map();
  const transfers = await Promise.all(logs.map(async (log) => {
    const transfer = erc20Transfer(log);
    if (!transfer) return null;
    if (!transactionCache.has(log.transactionHash)) {
      transactionCache.set(log.transactionHash, Promise.all([
        provider.getTransaction(log.transactionHash),
        provider.getTransactionReceipt(log.transactionHash),
        provider.getBlock(log.blockNumber),
      ]));
    }
    const [transaction, receipt, block] = await transactionCache.get(log.transactionHash);
    const gasUsed = receipt?.gasUsed || 0n;
    const gasPrice = receipt?.gasPrice || transaction?.gasPrice || transaction?.maxFeePerGas || 0n;
    return {
      hash: log.transactionHash,
      block: log.blockNumber,
      logIndex: log.index,
      timestamp: new Date((block?.timestamp || 0) * 1000).toISOString(),
      method: transaction ? transactionMethod(transaction.data) : "Token Transfer",
      from: transfer.from,
      to: transfer.to,
      amount: transfer.rawAmount,
      fee: nativeValue(gasUsed * gasPrice, coinSymbol),
      transaction: transaction ? {
        hash: transaction.hash,
        from: transaction.from,
        to: transaction.to,
        value: transaction.value.toString(),
        block: receipt.blockNumber,
        transactionIndex: receipt.index,
        timestamp: new Date((block?.timestamp || 0) * 1000).toISOString(),
        method: transactionMethod(transaction.data, transaction.to),
        status: receipt.status === 0 ? "Failed" : "Success",
        fee: (gasUsed * gasPrice).toString(),
        gasUsed: gasUsed.toString(),
        nonce: transaction.nonce,
        gasLimit: transaction.gasLimit.toString(),
        gasPrice: gasPrice.toString(),
        input: transaction.data,
        contractAddress: receipt?.contractAddress || null,
        tokenTransfers: [],
      } : null,
    };
  }));
  return { token, creator, holderCount, transferCount: logs.length, firstBlock, latestBlock, transfers: transfers.filter(Boolean).reverse() };
}

async function loadTransactions(provider, address, scanDepth) {
  const latestBlock = await provider.getBlockNumber();
  const firstBlock = Math.max(0, latestBlock - scanDepth + 1);
  const matchingTransactions = [];
  const normalizedAddress = address?.toLowerCase() || "";
  let nextBlock = latestBlock;

  async function scanWorker() {
    while (nextBlock >= firstBlock) {
      const blockNumber = nextBlock--;
      const block = await provider.getBlock(blockNumber, true);
      if (!block) continue;

      for (let transactionIndex = 0; transactionIndex < block.prefetchedTransactions.length; transactionIndex += 1) {
        const transaction = block.prefetchedTransactions[transactionIndex];
        const from = transaction.from || "";
        const to = transaction.to || "";
        if (normalizedAddress && from.toLowerCase() !== normalizedAddress && to.toLowerCase() !== normalizedAddress) continue;

        const receipt = await provider.getTransactionReceipt(transaction.hash);
        const gasUsed = receipt?.gasUsed || 0n;
        const gasPrice = receipt?.gasPrice || transaction.gasPrice || transaction.maxFeePerGas || 0n;
        matchingTransactions.push({
          hash: transaction.hash,
          from,
          to,
          value: transaction.value.toString(),
          block: block.number,
          transactionIndex,
          timestamp: new Date(block.timestamp * 1000).toISOString(),
          method: transactionMethod(transaction.data, transaction.to),
          status: receipt?.status === 0 ? "Failed" : "Success",
          fee: (gasUsed * gasPrice).toString(),
          gasUsed: gasUsed.toString(),
          nonce: transaction.nonce,
          gasLimit: transaction.gasLimit.toString(),
          gasPrice: gasPrice.toString(),
          input: transaction.data,
          tokenTransfers: [],
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(8, latestBlock - firstBlock + 1) }, scanWorker));
  matchingTransactions.sort((a, b) => b.block - a.block || b.transactionIndex - a.transactionIndex);
  return matchingTransactions;
}

async function loadTransactionByHash(provider, hash) {
  const [transaction, receipt, chain] = await Promise.all([
    provider.getTransaction(hash),
    provider.getTransactionReceipt(hash),
    provider.getNetwork(),
  ]);
  if (!transaction || !receipt || receipt.blockNumber === null) throw new Error("Transaction not found on this network.");
  const block = await provider.getBlock(receipt.blockNumber);
  const gasUsed = receipt.gasUsed || 0n;
  const gasPrice = receipt.gasPrice || transaction.gasPrice || transaction.maxFeePerGas || 0n;
  const tokenAbi = ["function symbol() view returns(string)", "function decimals() view returns(uint8)"];
  const tokenTransfers = await Promise.all(receipt.logs.map(async (log) => {
    const transfer = erc20Transfer(log);
    if (!transfer) return null;
    const token = new Contract(transfer.token, tokenAbi, provider);
    const [symbol, decimals] = await Promise.all([token.symbol().catch(() => "TOKEN"), token.decimals().catch(() => 18n)]);
    return { ...transfer, symbol, decimals: Number(decimals), amount: formatUnits(transfer.rawAmount, Number(decimals)) };
  }));
  return {
    hash: transaction.hash,
    from: transaction.from,
    to: transaction.to,
    value: transaction.value.toString(),
    block: receipt.blockNumber,
    transactionIndex: receipt.index,
    timestamp: new Date((block?.timestamp || 0) * 1000).toISOString(),
          method: transactionMethod(transaction.data, transaction.to),
    status: receipt.status === 0 ? "Failed" : "Success",
    fee: (gasUsed * gasPrice).toString(),
    gasUsed: gasUsed.toString(),
    nonce: transaction.nonce,
    gasLimit: transaction.gasLimit.toString(),
    gasPrice: gasPrice.toString(),
    input: transaction.data,
    contractAddress: receipt.contractAddress || null,
    tokenTransfers: tokenTransfers.filter(Boolean),
    chainId: chain.chainId.toString(),
  };
}

function TransactionDetails({ tx, address, explorerBase, coinSymbol, tokenBalances, copied, copy, open = false }) {
  const [transferView, setTransferView] = useState("all");
  const focusAddress = (address || tx.from).toLowerCase();
  const contractCreation = !tx.to;
  const contractCall = Boolean(tx.to && tx.input && tx.input !== "0x");
  const fields = [
    ["Transaction Hash", tx.hash],
    ["Status", txStatus(tx)],
    ["Block", tx.block.toLocaleString()],
    ["Timestamp", formatDate(tx.timestamp)],
    [contractCreation ? "Contract Creator" : "From", tx.from],
    [contractCreation ? "Created Contract" : contractCall ? "Interacted Contract" : "To", contractCreation ? tx.contractAddress || "Unavailable from RPC receipt" : tx.to || "Unknown"],
    ...(contractCall ? [["Function Called", tx.method], ["Function Selector", tx.input.slice(0, 10)]] : []),
    ["Value", nativeValue(tx.value, coinSymbol)],
    ["Transaction Fee", nativeValue(tx.fee, coinSymbol)],
    ["Gas Price", `${Number(formatUnits(BigInt(tx.gasPrice || "0"), 9)).toLocaleString(undefined, { maximumFractionDigits: 4 })} Gwei`],
    ["Gas Limit", BigInt(tx.gasLimit).toLocaleString()],
    ["Gas Used", BigInt(tx.gasUsed).toLocaleString()],
    ["Nonce", String(tx.nonce)],
    ["Input Data", tx.input === "0x" ? "Native transfer" : tx.input],
  ];
  const netTransfers = new Map();
  for (const transfer of tx.tokenTransfers) {
    const direction = transfer.from.toLowerCase() === focusAddress ? -1n : transfer.to.toLowerCase() === focusAddress ? 1n : 0n;
    if (!direction) continue;
    const key = transfer.token.toLowerCase();
    const previous = netTransfers.get(key) || { ...transfer, net: 0n };
    previous.net += direction * transfer.rawAmount;
    netTransfers.set(key, previous);
  }
  const visibleTransfers = transferView === "all"
    ? tx.tokenTransfers.map((transfer) => ({ ...transfer, direction: transfer.from.toLowerCase() === focusAddress ? "OUT" : transfer.to.toLowerCase() === focusAddress ? "IN" : "HOP" }))
    : [...netTransfers.values()].filter((transfer) => transfer.net !== 0n).map((transfer) => ({ ...transfer, direction: transfer.net > 0n ? "NET IN" : "NET OUT", amount: formatUnits(transfer.net < 0n ? -transfer.net : transfer.net, transfer.decimals ?? 18) }));

  return <details className="tx-detail-toggle" open={open}><summary>{open ? "Transaction record" : "View transaction details"}</summary><div className="tx-detail-sheet"><div className="tx-detail-heading"><strong>Transaction Details</strong><span className={`status status-${txStatus(tx).toLowerCase()}`}><i />{txStatus(tx)}</span></div><dl className="tx-detail-list">{fields.map(([label, value]) => <div className="tx-detail-line" key={label}><dt>{label}</dt><dd>{label === "Transaction Hash" && explorerBase ? <a href={`${explorerBase}/tx/${tx.hash}`} target="_blank" rel="noreferrer">{value}</a> : <code>{value}</code>}{["Transaction Hash", "From", "To"].includes(label) && value !== "Contract creation" && <button className="copy-inline" onClick={() => copy(value, `detail-${tx.hash}-${label}`)} aria-label={`Copy ${label}`}>{copied === `detail-${tx.hash}-${label}` ? <Check size={13} /> : <Copy size={13} />}</button>}</dd></div>)}</dl>{tx.tokenTransfers.length > 0 && <div className="receipt-transfers"><div className="receipt-transfers-heading"><strong>BEP-20 Tokens Transferred <span>{tx.tokenTransfers.length}</span></strong><div role="tablist" aria-label="Token transfer view"><button className={transferView === "all" ? "is-active" : ""} onClick={() => setTransferView("all")}>All Transfers</button><button className={transferView === "net" ? "is-active" : ""} onClick={() => setTransferView("net")}>Net Transfers</button></div></div><div className="receipt-transfer-list">{visibleTransfers.length ? visibleTransfers.map((transfer, transferIndex) => { const token = tokenBalances.find((item) => item.address.toLowerCase() === transfer.token.toLowerCase()); const decimals = transfer.decimals ?? token?.decimals ?? 18; const amount = transfer.amount ?? formatUnits(transfer.rawAmount, decimals); return <div className="receipt-transfer-row" key={`${transfer.token}-${transfer.from}-${transfer.to}-${transferIndex}`}><span><b>From</b><code>{shortAddress(transfer.from)}</code><button className="copy-inline" onClick={() => copy(transfer.from, `receipt-from-${tx.hash}-${transferIndex}`)} aria-label="Copy transfer sender"><Copy size={13} /></button></span><span><b>To</b><code>{shortAddress(transfer.to)}</code><button className="copy-inline" onClick={() => copy(transfer.to, `receipt-to-${tx.hash}-${transferIndex}`)} aria-label="Copy transfer recipient"><Copy size={13} /></button></span><span><b>For</b><strong>{amount}</strong><code className="receipt-token-name">{transfer.name || token?.name || transfer.symbol} ({transfer.symbol})</code><button className="copy-inline" onClick={() => copy(transfer.token, `receipt-token-${tx.hash}-${transferIndex}`)} aria-label="Copy token contract"><Copy size={13} /></button></span></div>; }) : <p className="receipt-no-net">No net token movement for this address in the transaction.</p>}</div></div>}</div></details>;
}

function TransactionLedger({ transactions, visibleCount, setVisibleCount, address, coinSymbol, explorerBase, openTransaction, openAddress, copy, copied, refresh }) {
  return <section className="transactions-section">
    <div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> LEDGER</div><h2>{address ? "Address transactions" : "All blockchain transactions"}</h2></div><div className="ledger-heading-actions"><span className="result-count">{transactions.length ? `SHOWING ${Math.min(visibleCount, transactions.length)} OF ${transactions.length}` : "0 RECORDS"}</span><button className="refresh-button" onClick={refresh}><RefreshCw size={14} /> Refresh</button></div></div>
    {!transactions.length ? <div className="empty-state"><span className="empty-icon"><Activity size={20} /></span><div><strong>No transactions found</strong><p>{address ? "No direct transfers involving this address were found in the scanned blocks." : "No transactions were found in the scanned recent blocks."}</p></div></div> : <div className="chain-ledger-scroll"><div className="chain-ledger">
      <div className="chain-ledger-header"><span>Transaction Hash</span><span>Method</span><span>Block</span><span>Age</span><span>From</span><span>To</span><span>Amount</span><span>Txn Fee</span></div>
      {transactions.slice(0, visibleCount).map((tx) => {
        const outgoing = address ? tx.from.toLowerCase() === address.toLowerCase() : false;
        return <article className="chain-ledger-row" key={tx.hash}>
          <button className="ledger-hash" onClick={() => openTransaction(tx)} title={tx.hash}>{shortAddress(tx.hash)}</button>
          <span className="ledger-method">{tx.method}</span>
          <span className="ledger-block">{tx.block.toLocaleString()}</span>
          <span className="ledger-age">{timeAgo(tx.timestamp)}</span>
          <button type="button" className="ledger-address" title={`Open address ${tx.from}`} onClick={() => openAddress(tx.from)}>{shortAddress(tx.from)}</button>
          {tx.to ? <button type="button" className="ledger-to" title={`Open address ${tx.to}`} onClick={() => openAddress(tx.to)}>{shortAddress(tx.to)}</button> : <span className="ledger-to">Contract creation</span>}
          <span className="ledger-amount">{nativeValue(tx.value, coinSymbol)}{address && <i className={outgoing ? "direction-out" : "direction-in"}>{outgoing ? "OUT" : "IN"}</i>}</span>
          <span className="ledger-fee">{nativeValue(tx.fee, coinSymbol)}</span>
        </article>;
      })}
    </div></div>}
    {transactions.length > visibleCount && <button className="show-more-button" onClick={() => setVisibleCount((count) => count + TRANSACTIONS_PER_PAGE)}><ChevronDown size={15} /> Show more transactions</button>}
  </section>;
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("blockchain-theme") || "light");
  const [view, setView] = useState(() => {
    if (/^\/tx\/0x[\da-f]{64}$/i.test(window.location.pathname)) return "transaction";
    if (/^\/token\/0x[\da-f]{40}$/i.test(window.location.pathname)) return "token";
    return /^\/address\/0x[\da-f]{40}$/i.test(window.location.pathname) ? "address" : "home";
  });
  const [routeHash, setRouteHash] = useState(() => window.location.pathname.match(/^\/tx\/(0x[\da-f]{64})$/i)?.[1] || "");
  const [tokenAddress, setTokenAddress] = useState(() => window.location.pathname.match(/^\/token\/(0x[\da-f]{40})$/i)?.[1] || "");
  const [tokenInfo, setTokenInfo] = useState(null);
  const [tokenPageData, setTokenPageData] = useState(null);
  const [tokenPageLoading, setTokenPageLoading] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [settings, setSettings] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addressInput, setAddressInput] = useState("");
  const [address, setAddress] = useState(() => window.location.pathname.match(/^\/address\/(0x[\da-f]{40})$/i)?.[1] || new URLSearchParams(window.location.search).get("address") || "");
  const [network, setNetwork] = useState(null);
  const [contractDetected, setContractDetected] = useState(false);
  const [latestBlock, setLatestBlock] = useState(null);
  const [balance, setBalance] = useState(null);
  const [coinSymbol, setCoinSymbol] = useState("ETH");
  const [transactions, setTransactions] = useState([]);
  const [visibleTransactionCount, setVisibleTransactionCount] = useState(TRANSACTIONS_PER_PAGE);
  const [tokenBalances, setTokenBalances] = useState([]);
  const [manualTokenInput, setManualTokenInput] = useState("");
  const [manualTokenAddresses, setManualTokenAddresses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const autoScanStarted = useRef(false);

  useEffect(() => {
    function syncRoute() {
      const hash = window.location.pathname.match(/^\/tx\/(0x[\da-f]{64})$/i)?.[1] || "";
      const routeToken = window.location.pathname.match(/^\/token\/(0x[\da-f]{40})$/i)?.[1] || "";
      const queryToken = new URLSearchParams(window.location.search).get("token") || "";
      const routeAddress = window.location.pathname.match(/^\/address\/(0x[\da-f]{40})$/i)?.[1] || "";
      const queryAddress = new URLSearchParams(window.location.search).get("address") || "";
      setRouteHash(hash);
      setView(hash ? "transaction" : routeToken ? "token" : routeAddress ? "address" : "home");
      setSelectedTransaction(null);
      setTokenAddress(routeToken || queryToken);
      setTokenInfo(null);
      setTokenPageData(null);
      const nextAddress = routeAddress || queryAddress;
      setAddress(nextAddress);
      setAddressInput(nextAddress);
    }
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    if (view !== "transaction" || !routeHash || selectedTransaction?.hash?.toLowerCase() === routeHash.toLowerCase()) return;
    let cancelled = false;
    setTransactionLoading(true);
    const provider = new JsonRpcProvider(settings.rpcUrl);
    Promise.all([loadTransactionByHash(provider, routeHash), provider.getNetwork()])
      .then(([transaction, chain]) => {
        if (cancelled) return;
        setSelectedTransaction(transaction);
        setNetwork({ chainId: chain.chainId.toString(), name: chain.name === "unknown" ? `Chain ${chain.chainId}` : chain.name });
        setCoinSymbol(nativeSymbol(chain.chainId.toString()));
      })
      .catch((caught) => {
        if (!cancelled) setError(caught.message || "Could not load transaction from this network.");
      })
      .finally(() => { if (!cancelled) setTransactionLoading(false); });
    return () => { cancelled = true; };
  }, [view, routeHash, selectedTransaction, settings.rpcUrl]);

  useEffect(() => {
    if (view !== "token" || !tokenAddress) return;
    let cancelled = false;
    setTokenPageLoading(true);
    setError("");
    const provider = new JsonRpcProvider(settings.rpcUrl);
    provider.getNetwork()
      .then(async (chain) => {
        const symbol = nativeSymbol(chain.chainId.toString());
        const data = await loadTokenPageData(provider, tokenAddress, Math.max(1, Math.min(20_000, Number(settings.scanDepth) || 5000)), symbol);
        if (cancelled) return;
        setTokenPageData(data);
        setTokenInfo(data.token);
        setNetwork({ chainId: chain.chainId.toString(), name: chain.name === "unknown" ? `Chain ${chain.chainId}` : chain.name });
        setCoinSymbol(symbol);
      })
      .catch((caught) => { if (!cancelled) setError(caught.message || "Could not load token details."); })
      .finally(() => { if (!cancelled) setTokenPageLoading(false); });
    return () => { cancelled = true; };
  }, [view, tokenAddress, settings.rpcUrl, settings.scanDepth]);

  async function inspect(target = addressInput, tokenAddresses = manualTokenAddresses) {
    const normalized = target.trim();
    if (!isAddress(normalized)) {
      setError("Enter a valid EVM address, starting with 0x.");
      return;
    }
    setLoading(true);
    setError("");
    setAddress(normalized);
    setAddressInput(normalized);
    setView("address");
    if (window.location.pathname.toLowerCase() !== `/address/${normalized}`.toLowerCase()) {
      window.history.pushState({}, "", `/address/${normalized}`);
    }
    setTransactions([]);
    setVisibleTransactionCount(TRANSACTIONS_PER_PAGE);
    setTokenBalances([]);
    setContractDetected(false);
    try {
      const provider = new JsonRpcProvider(settings.rpcUrl);
      const [chain, nativeBalance, latestBlock, deployedCode, detectedToken] = await Promise.all([
        provider.getNetwork(),
        provider.getBalance(normalized),
        provider.getBlockNumber(),
        provider.getCode(normalized),
        detectTokenContract(provider, normalized),
      ]);
      setContractDetected(deployedCode !== "0x");
      setTokenInfo(detectedToken);
      const scanDepth = Math.max(1, Math.min(20_000, Number(settings.scanDepth) || 5000));
      const firstBlock = Math.max(0, latestBlock - scanDepth + 1);
      const [tokenData] = await Promise.all([
        loadTokenBalances(provider, normalized, firstBlock, latestBlock, tokenAddresses),
      ]);
      const history = await loadTransactions(provider, normalized, scanDepth);
      setNetwork({ chainId: chain.chainId.toString(), name: chain.name === "unknown" ? `Chain ${chain.chainId}` : chain.name });
      setCoinSymbol(nativeSymbol(chain.chainId.toString()));
      setBalance(formatEther(nativeBalance));
      setTransactions(history);
      setTokenBalances(tokenData.tokens);
    } catch (caught) {
      setError(caught.message || "Could not load address data. Check that the local blockchain is running.");
      setBalance(null);
      setTransactions([]);
      setTokenBalances([]);
      setContractDetected(false);
    } finally {
      setLoading(false);
    }
  }

  async function scanChainTransactions() {
    setLoading(true);
    setError("");
    setTransactions([]);
    setVisibleTransactionCount(TRANSACTIONS_PER_PAGE);
    setLatestBlock(null);
    try {
      const provider = new JsonRpcProvider(settings.rpcUrl);
      const [chain, latestBlock] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
      setLatestBlock(latestBlock);
      const scanDepth = Math.max(1, Math.min(20_000, Number(settings.scanDepth) || 5000));
      const history = await loadTransactions(provider, null, scanDepth);
      setNetwork({ chainId: chain.chainId.toString(), name: chain.name === "unknown" ? `Chain ${chain.chainId}` : chain.name });
      setCoinSymbol(nativeSymbol(chain.chainId.toString()));
      setBalance(null);
      setTokenBalances([]);
      setTransactions(history);
      if (latestBlock >= 0 && history.length === 0) setError(`No transactions found in the latest ${Math.min(latestBlock + 1, scanDepth).toLocaleString()} blocks.`);
    } catch (caught) {
      setError(caught.message || "Could not scan the local chain. Check that the blockchain node is running.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (loading) return;
    if (view === "address" && address && balance === null) {
      void inspect(address);
      return;
    }
    if (view !== "home") return;
    if (address) {
      if (balance === null) void inspect(address);
      return;
    }
    if (!autoScanStarted.current) {
      autoScanStarted.current = true;
      void scanChainTransactions();
    }
  }, [view]);

  function addToken(event) {
    event.preventDefault();
    const tokenAddress = manualTokenInput.trim();
    if (!isAddress(tokenAddress)) {
      setError("Enter a valid token contract address.");
      return;
    }
    const nextTokens = [...new Set([...manualTokenAddresses, tokenAddress])];
    setManualTokenAddresses(nextTokens);
    setManualTokenInput("");
    if (address) void inspect(address, nextTokens);
  }

  function saveSettings(event) {
    event.preventDefault();
    const normalized = {
      rpcUrl: String(draft.rpcUrl).trim(),
      scanDepth: Math.max(1, Math.min(20_000, Number(draft.scanDepth) || defaults.scanDepth)),
      explorerUrl: String(draft.explorerUrl || "").trim(),
      verifierUrl: String(draft.verifierUrl || "").trim(),
    };
    setSettings(normalized);
    localStorage.setItem("blockscope-settings", JSON.stringify(normalized));
    setSettingsOpen(false);
    if (address) void inspect(address);
    else void scanChainTransactions();
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("blockchain-theme", nextTheme);
  }

  function openTransaction(transaction, fromTokenPage = false) {
    const search = fromTokenPage && tokenAddress
      ? `?token=${encodeURIComponent(tokenAddress)}`
      : address ? `?address=${encodeURIComponent(address)}` : "";
    window.history.pushState({}, "", `/tx/${transaction.hash}${search}`);
    setRouteHash(transaction.hash);
    setSelectedTransaction(null);
    setView("transaction");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openTokenDetails() {
    if (!address || !tokenInfo) return;
    window.history.pushState({}, "", `/token/${address}`);
    setTokenAddress(address);
    setView("token");
    setTokenPageData(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function returnFromToken() {
    const destination = address ? `/address/${address}` : "/";
    window.history.pushState({}, "", destination);
    setTokenAddress("");
    setView(address ? "address" : "home");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function returnToResults() {
    if (tokenAddress && new URLSearchParams(window.location.search).has("token")) {
      window.history.pushState({}, "", `/token/${tokenAddress}`);
      setRouteHash("");
      setSelectedTransaction(null);
      setView("token");
      return;
    }
    const destination = address ? `/address/${address}` : "/";
    window.history.pushState({}, "", destination);
    setRouteHash("");
    setSelectedTransaction(null);
    setView(address ? "address" : "home");
    if (address) setAddressInput(address);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showAllTransactions() {
    window.history.pushState({}, "", "/");
    setAddress("");
    setAddressInput("");
    setTokenInfo(null);
    setBalance(null);
    setTokenBalances([]);
    setView("home");
    setVisibleTransactionCount(TRANSACTIONS_PER_PAGE);
    void scanChainTransactions();
  }

  async function copy(value, key) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1300);
    } catch {
      setError("Clipboard access is unavailable in this browser context.");
    }
  }

  const explorerBase = settings.explorerUrl.replace(/\/$/, "");
  const transactionLedger = !loading && (view === "home" || view === "address")
    ? <TransactionLedger transactions={transactions} visibleCount={visibleTransactionCount} setVisibleCount={setVisibleTransactionCount} address={view === "address" ? address : ""} coinSymbol={coinSymbol} explorerBase={explorerBase} openTransaction={openTransaction} openAddress={(target) => void inspect(target)} copy={copy} copied={copied} refresh={() => view === "address" ? void inspect(address) : void scanChainTransactions()} />
    : null;

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="topbar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); showAllTransactions(); }} aria-label="Blockchain home"><span className="brand-icon"><Blocks size={19} /></span><span>BLOCKCHAIN</span></a>
        <div className="topbar-actions">
          {network && <span className="network-pill"><i />{network.name} <span>· {network.chainId}</span></span>}
          <button className="icon-button theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button className="icon-button settings-trigger" onClick={() => setSettingsOpen(!settingsOpen)} aria-label="Network settings" title="Network settings"><Settings2 size={17} /></button>
        </div>
      </header>

      <main id="top">
        {view === "transaction" ? <section className="transaction-page">
          <button className="back-to-results" onClick={returnToResults}><ArrowLeft size={15} /> Back to address results</button>
          <div className="transaction-page-heading"><div className="eyebrow"><span className="eyebrow-line" /> TRANSACTION RECORD</div><h1>Transaction details</h1><p>Full transaction and token-transfer data read from the connected local chain.</p></div>
          {transactionLoading && <div className="loading-state"><LoaderCircle className="spin" size={22} /><span>Loading transaction from local blockchain...</span></div>}
          {!transactionLoading && selectedTransaction && <TransactionDetails tx={selectedTransaction} address={address} explorerBase={explorerBase} coinSymbol={coinSymbol} tokenBalances={tokenBalances} copied={copied} copy={copy} open />}
          {!transactionLoading && !selectedTransaction && error && <div className="error-banner" role="alert"><CircleAlert size={17} /><span>{error}</span></div>}
        </section> : view === "token" ? <TokenPage tokenAddress={tokenAddress} tokenData={tokenPageData} loading={tokenPageLoading} error={error} onBack={returnFromToken} onCopy={copy} copied={copied} onOpenTransaction={(transfer) => openTransaction({ hash: transfer.hash }, true)} onOpenAddress={(target) => void inspect(target)} coinSymbol={coinSymbol} /> : view === "address" ? <AddressPage address={address} balance={balance} coinSymbol={coinSymbol} network={network} tokenInfo={tokenInfo} transactions={transactions} tokenBalances={tokenBalances} manualTokenInput={manualTokenInput} setManualTokenInput={setManualTokenInput} onAddToken={addToken} onCopy={copy} copied={copied} onRefresh={() => void inspect(address)} onShowAll={showAllTransactions} onViewToken={openTokenDetails} contractDetected={contractDetected} rpcUrl={settings.rpcUrl} verifierUrl={settings.verifierUrl} chainId={network?.chainId} loading={loading} error={error} dismissError={() => setError("")}>{transactionLedger}</AddressPage> : <HomePage addressInput={addressInput} setAddressInput={setAddressInput} onInspect={inspect} loading={loading} error={error} dismissError={() => setError("")} transactionCount={transactions.length} latestBlock={latestBlock} scanDepth={Math.max(1, Math.min(20_000, Number(settings.scanDepth) || 5000))}>{transactionLedger}</HomePage>}
      </main>

      <footer className="app-footer"><span>BLOCKCHAIN <i>·</i> LOCAL ADDRESS EXPLORER</span><span>Local JSON-RPC · Chain {network?.chainId || "not connected"}</span></footer>

      {settingsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-heading"><div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> CONNECTION</div><h2 id="settings-heading">Local network settings</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={17} /></button></div><p className="modal-copy">Connect to the Hardhat JSON-RPC node. Settings stay in this browser only.</p><form onSubmit={saveSettings}><label>JSON-RPC URL<input value={draft.rpcUrl} onChange={(event) => setDraft({ ...draft, rpcUrl: event.target.value })} required type="url" /></label><label>Recent blocks to scan<input value={draft.scanDepth} onChange={(event) => setDraft({ ...draft, scanDepth: event.target.value })} required type="number" min="1" max="20000" /></label><label>Optional explorer URL<input value={draft.explorerUrl} onChange={(event) => setDraft({ ...draft, explorerUrl: event.target.value })} type="url" placeholder="Leave blank for local-only use" /></label>
<label>PHP verifier API URL<input value={draft.verifierUrl} onChange={(event) => setDraft({ ...draft, verifierUrl: event.target.value })} type="url" placeholder="http://127.0.0.1:8081" /></label>
<div className="modal-actions"><button className="button-quiet" type="button" onClick={() => { setDraft(defaults); localStorage.removeItem("blockscope-settings"); }}>Restore local defaults</button><button className="button-save" type="submit">Save settings</button></div></form></section></div>}
    </div>
  );
}
