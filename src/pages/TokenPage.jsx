import { ArrowLeft, Blocks, Check, Copy, LoaderCircle, UsersRound, ArrowLeftRight, UserRound, Coins } from "lucide-react";
import { useState } from "react";
import { formatUnits } from "ethers";

const PAGE_SIZE = 10;

function shortAddress(value = "") {
  return value ? `${value.slice(0, 8)}...${value.slice(-6)}` : "Unknown";
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function timeAgo(value) {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - Math.floor(new Date(value).getTime() / 1000));
  if (elapsed < 60) return `${elapsed} sec ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)} min ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)} hr ago`;
  return `${Math.floor(elapsed / 86400)} days ago`;
}

export default function TokenPage({ tokenAddress, tokenData, loading, error, onBack, onCopy, copied, onOpenTransaction, onOpenAddress }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const token = tokenData?.token;
  const transfers = tokenData?.transfers || [];

  return <section className="token-page">
    <button className="back-to-results" onClick={onBack}><ArrowLeft size={15} /> Back to address results</button>
    {loading && <div className="loading-state"><LoaderCircle className="spin" size={22} /><span>Reading token data and Transfer events from the local chain...</span></div>}
    {error && !loading && <div className="error-banner" role="alert"><span>{error}</span></div>}
    {!loading && token && <>
      <div className="token-page-heading">
        <div className="token-identity">
          <span className="token-symbol-mark"><Blocks size={25} /></span>
          <div className="token-heading-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> TOKEN CONTRACT</div>
            <h1>{token.name} <em>({token.symbol})</em></h1>
            <div className="token-address-line"><code>{tokenAddress}</code><button className="copy-inline" onClick={() => onCopy(tokenAddress, "token-page-address")} aria-label="Copy token contract" title="Copy token contract">{copied === "token-page-address" ? <Check size={14} /> : <Copy size={14} />}</button></div>
          </div>
        </div>
        <span className="token-contract-status"><i /> LOCAL CONTRACT</span>
      </div>
      <div className="token-page-metrics">
        <article className="token-stat token-stat-supply"><div className="token-stat-label"><span>TOTAL SUPPLY</span><Coins size={16} /></div><strong>{Number(formatUnits(token.totalSupply, token.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })} <small>{token.symbol}</small></strong><small>Current on-chain amount</small></article>
        <article className="token-stat"><div className="token-stat-label"><span>HOLDERS FOUND</span><UsersRound size={16} /></div><strong>{tokenData.holderCount.toLocaleString()}</strong><small>Nonzero balances in scanned range</small></article>
        <article className="token-stat"><div className="token-stat-label"><span>TRANSFER EVENTS</span><ArrowLeftRight size={16} /></div><strong>{tokenData.transferCount.toLocaleString()}</strong><small>Blocks {tokenData.firstBlock.toLocaleString()}–{tokenData.latestBlock.toLocaleString()}</small></article>
        <article className="token-stat token-creator"><div className="token-stat-label"><span>CREATOR</span><UserRound size={16} /></div><strong>{tokenData.creator ? shortAddress(tokenData.creator) : "Not found in scan"}</strong>{tokenData.creator ? <code>{tokenData.creator}</code> : <small>Creation block is outside the scanned range</small>}</article>
      </div>
      <section className="transactions-section token-transactions">
        <div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> TOKEN LEDGER</div><h2>{token.symbol} transfers</h2></div><span className="result-count">SHOWING {Math.min(visibleCount, transfers.length)} OF {transfers.length}</span></div>
        {!transfers.length ? <div className="empty-state"><span className="empty-icon"><Blocks size={20} /></span><div><strong>No token transfers in scanned blocks</strong><p>Widen the recent block scan in Network settings to search further back.</p></div></div> : <div className="chain-ledger-scroll"><div className="chain-ledger token-transfer-ledger">
          <div className="chain-ledger-header"><span>Transaction Hash</span><span>Block</span><span>Age</span><span>From</span><span>To</span><span>Amount ({token.symbol})</span><span>Txn Fee</span></div>
          {transfers.slice(0, visibleCount).map((transfer, index) => <article className="chain-ledger-row" key={`${transfer.hash}-${transfer.logIndex}`}><button className="ledger-hash" onClick={() => onOpenTransaction(transfer.transaction)} title={transfer.hash}>{shortAddress(transfer.hash)}</button><span className="ledger-block">{transfer.block.toLocaleString()}</span><span className="ledger-age" title={formatDate(transfer.timestamp)}>{timeAgo(transfer.timestamp)}</span><button type="button" className="ledger-address" title={`Open address ${transfer.from}`} onClick={() => onOpenAddress(transfer.from)}>{shortAddress(transfer.from)}</button><button type="button" className="ledger-to" title={`Open address ${transfer.to}`} onClick={() => onOpenAddress(transfer.to)}>{shortAddress(transfer.to)}</button><span className="ledger-amount">{Number(formatUnits(transfer.amount, token.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })} {token.symbol}</span><span className="ledger-fee">{transfer.fee}</span></article>)}
        </div></div>}
        {transfers.length > visibleCount && <button className="show-more-button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Show more transfers</button>}
      </section>
    </>}
  </section>;
}
