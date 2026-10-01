import { CircleAlert, Fingerprint, LoaderCircle, Search } from "lucide-react";

export default function HomePage({ addressInput, setAddressInput, onInspect, loading, error, dismissError, transactionCount, latestBlock, scanDepth, children }) {
  return <>
    <section className="hero-row explorer-home-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-line" /> BLOCKCHAIN EXPLORER <span className="eyebrow-index">CHAIN 31337 · HARDHAT</span></div>
        <h1>Explore the blockchain</h1>
        <p className="hero-copy">Search addresses, transactions, and contracts on your connected network.</p>
      </div>
    </section>

    <form className="search-panel" onSubmit={(event) => { event.preventDefault(); void onInspect(); }}>
      <label htmlFor="address-search"><Fingerprint size={16} /> SEARCH BY ADDRESS, TRANSACTION, OR BLOCK</label>
      <div className="search-control"><input id="address-search" value={addressInput} onChange={(event) => setAddressInput(event.target.value)} placeholder="0x address or transaction hash" spellCheck="false" autoComplete="off" /><button type="submit" disabled={loading || !addressInput.trim()}><Search size={16} /> Search <span>↵</span></button></div>
      <div className="search-hint"><span>Connected to your configured RPC</span><span>·</span><span>Read access does not require a wallet</span></div>
    </form>

    <section className="home-chain-stats" aria-label="Chain activity summary">
      <article className="home-chain-stat"><span>TRANSACTIONS SCANNED</span><strong>{loading ? "Scanning..." : transactionCount.toLocaleString()}</strong><small>Across the latest {scanDepth.toLocaleString()} blocks</small></article>
      <article className="home-chain-stat"><span>LATEST BLOCK</span><strong>{latestBlock === null ? "--" : latestBlock.toLocaleString()}</strong><small>Current height on the connected network</small></article>
    </section>

    {error && <div className="error-banner" role="alert"><CircleAlert size={17} /><span>{error}</span><button onClick={dismissError} aria-label="Dismiss error">×</button></div>}
    {loading && <div className="loading-state"><LoaderCircle className="spin" size={22} /><span>Scanning recent local blocks for this address...</span></div>}
    {!loading && children}
  </>;
}
