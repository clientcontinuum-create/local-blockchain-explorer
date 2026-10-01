import { ArrowLeft, Blocks, CircleAlert, Copy, ExternalLink, LoaderCircle, RefreshCw, Wallet } from "lucide-react";
import { ArrowLeftRight, FileCode2 } from "lucide-react";
import { useEffect, useState } from "react";
import ContractVerification from "../components/ContractVerification.jsx";

export default function AddressPage({
  address,
  balance,
  coinSymbol,
  network,
  tokenInfo,
  transactions,
  tokenBalances,
  manualTokenInput,
  setManualTokenInput,
  onAddToken,
  onCopy,
  copied,
  onRefresh,
  onShowAll,
  onViewToken,
  contractDetected,
  rpcUrl,
  verifierUrl,
  chainId,
  loading,
  error,
  dismissError,
  children,
}) {
  const [activeTab, setActiveTab] = useState("transactions");

  useEffect(() => {
    setActiveTab("transactions");
  }, [address]);

  return <>
    {error && <div className="error-banner" role="alert"><CircleAlert size={17} /><span>{error}</span><button onClick={dismissError} aria-label="Dismiss error">×</button></div>}
    {loading && <div className="loading-state"><LoaderCircle className="spin" size={22} /><span>Loading address balances and transactions...</span></div>}
    {!loading && balance !== null && <>
    <section className="results-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ADDRESS OVERVIEW</div><div className="address-title-row"><h2>{address.slice(0, 8)}...{address.slice(-6)}</h2><button className="icon-button" onClick={() => onCopy(address, "address")} aria-label="Copy address" title="Copy address">{copied === "address" ? "✓" : <Copy size={16} />}</button></div><code className="full-address">{address}</code>{tokenInfo && <button className="view-token-link" onClick={onViewToken}><Blocks size={14} /> View {tokenInfo.symbol} token details <ExternalLink size={13} /></button>}</div><div className="overview-actions"><button className="back-to-results" onClick={onShowAll}><ArrowLeft size={14} /> All transactions</button><button className="refresh-button" onClick={onRefresh}><RefreshCw size={15} /> Refresh</button></div></section>

    <section className="metrics-grid" aria-label="Address overview metrics">
      <article className="metric metric-balance"><div className="metric-label"><Wallet size={15} /> NATIVE BALANCE</div><strong>{Number(balance).toLocaleString(undefined, { maximumFractionDigits: 8 })} <small>{coinSymbol}</small></strong><span className="metric-foot">Available on {network?.name || "selected network"}</span><span className="metric-index">01</span></article>
      <article className="metric"><div className="metric-label"><Blocks size={15} /> TRANSACTIONS FOUND</div><strong>{transactions.length.toLocaleString()}</strong><span className="metric-foot">Recent direct transactions found</span><span className="metric-index">02</span></article>
      <article className="metric"><div className="metric-label"><Blocks size={15} /> NETWORK</div><strong className="metric-network">{network?.name || "EVM"}</strong><span className="metric-foot">Chain ID {network?.chainId || "--"}</span><span className="metric-index">03</span></article>
    </section>

    {contractDetected && <nav className="address-view-tabs" role="tablist" aria-label="Address details">
      <button type="button" role="tab" aria-selected={activeTab === "transactions"} aria-controls="address-transactions-panel" className={activeTab === "transactions" ? "is-active" : ""} onClick={() => setActiveTab("transactions")}><ArrowLeftRight size={15} /> Transactions</button>
      <button type="button" role="tab" aria-selected={activeTab === "contract"} aria-controls="address-contract-panel" className={activeTab === "contract" ? "is-active" : ""} onClick={() => setActiveTab("contract")}><FileCode2 size={15} /> Contract</button>
    </nav>}

    {contractDetected && activeTab === "contract" ? <section id="address-contract-panel" className="address-contract-view" role="tabpanel">
      <div className="contract-tab-summary"><div><span>CONTRACT ADDRESS</span><code>{address}</code></div><div><span>NETWORK</span><strong>{network?.name || `Chain ${chainId || "--"}`}</strong></div></div>
      <ContractVerification address={address} detected={contractDetected} rpcUrl={rpcUrl} apiUrl={verifierUrl} chainId={chainId} />
    </section> : <section id="address-transactions-panel" className="address-transactions-view" role="tabpanel" aria-label="Transactions">
      {tokenInfo && <button className="view-token-link" onClick={onViewToken}><Blocks size={14} /> View {tokenInfo.symbol} token details <ExternalLink size={13} /></button>}
    <section className="token-balances-section">
      <div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ASSETS</div><h2>Token balances</h2></div><span className="result-count">{tokenBalances.length} TOKENS</span></div>
      <form className="token-lookup" onSubmit={onAddToken}><input aria-label="Token contract address" value={manualTokenInput} onChange={(event) => setManualTokenInput(event.target.value)} placeholder="Add token contract address (optional)" spellCheck="false" /><button type="submit" disabled={!manualTokenInput.trim()}>Add token</button></form>
      <p className="token-scan-note">Tokens are discovered from BEP-20/ERC-20 transfers in the scanned blocks. Add a contract manually to check tokens with no recent transfers.</p>
      {!tokenBalances.length ? <div className="empty-state"><span className="empty-icon"><Wallet size={20} /></span><div><strong>No tokens discovered yet</strong><p>Scan blocks with token transfers or add a token contract address above.</p></div></div> : <div className="token-balance-grid">{tokenBalances.map((token) => <article className="token-balance-card" key={token.address}><div className="token-card-top"><span className="token-symbol">{token.symbol}</span><button className="copy-inline" onClick={() => onCopy(token.address, token.address)} aria-label="Copy token address" title={token.address}>{copied === token.address ? "✓" : <Copy size={13} />}</button></div><strong>{Number(token.balance).toLocaleString(undefined, { maximumFractionDigits: 6 })} <small>{token.symbol}</small></strong><span className="token-name">{token.name}</span><code>{token.address.slice(0, 8)}...{token.address.slice(-6)}</code></article>)}</div>}
    </section>

    {children}
  </section>}
    </>}
  </>;
}
