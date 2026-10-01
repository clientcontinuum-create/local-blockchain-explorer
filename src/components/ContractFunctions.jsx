import { useState } from "react";
import { BrowserProvider, Contract, Interface, JsonRpcProvider, parseEther } from "ethers";
import { LoaderCircle, Wallet } from "lucide-react";

function signatureOf(fragment) {
  return fragment.format("sighash");
}

function parseArgument(value, parameter) {
  const normalized = value.trim();
  if (parameter.type === "bool") {
    if (normalized !== "true" && normalized !== "false") throw new Error(`${parameter.name || parameter.type} must be true or false.`);
    return normalized === "true";
  }
  if (parameter.type.includes("[") || parameter.type.startsWith("tuple")) {
    try {
      return JSON.parse(normalized);
    } catch {
      throw new Error(`${parameter.name || parameter.type} must be valid JSON.`);
    }
  }
  if (!normalized) throw new Error(`${parameter.name || parameter.type} is required.`);
  return normalized;
}

function normalizeResult(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return Array.from(value, normalizeResult);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/^\d+$/.test(key)).map(([key, item]) => [key, normalizeResult(item)]));
  }
  return value;
}

function methodLabel(fragment) {
  const inputs = fragment.inputs.map((input) => input.type).join(", ");
  return `${fragment.name}(${inputs})`;
}

async function injectedChainId() {
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  return BigInt(chainId).toString();
}

export default function ContractFunctions({ address, abi, rpcUrl, chainId, activeTab }) {
  const [walletAddress, setWalletAddress] = useState("");
  const [walletError, setWalletError] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [busyMethod, setBusyMethod] = useState("");
  const [methodStates, setMethodStates] = useState({});
  const fragments = new Interface(abi || []).fragments.filter((item) => item.type === "function");
  const readFunctions = fragments.filter((item) => item.stateMutability === "view" || item.stateMutability === "pure");
  const writeFunctions = fragments.filter((item) => item.stateMutability !== "view" && item.stateMutability !== "pure");

  function setMethodState(signature, patch) {
    setMethodStates((current) => ({ ...current, [signature]: { ...current[signature], ...patch } }));
  }

  async function connectWallet() {
    setWalletError("");
    if (!window.ethereum) {
      setWalletError("No injected wallet was found. Install or unlock a browser wallet to write to this contract.");
      return;
    }
    setWalletBusy(true);
    try {
      const provider = new BrowserProvider(window.ethereum, "any");
      await provider.send("eth_requestAccounts", []);
      const walletChain = await injectedChainId();
      if (chainId && walletChain !== String(chainId)) {
        throw new Error(`Wallet reports chain ${walletChain}; switch it to chain ${chainId} before writing.`);
      }
      const signer = await provider.getSigner();
      setWalletAddress(await signer.getAddress());
    } catch (error) {
      setWalletAddress("");
      setWalletError(error.message || "Could not connect to the wallet.");
    } finally {
      setWalletBusy(false);
    }
  }

  async function switchWalletNetwork() {
    setWalletError("");
    if (!window.ethereum) {
      setWalletError("No injected browser wallet is available.");
      return;
    }
    setWalletBusy(true);
    try {
      const targetChain = String(chainId);
      const targetChainHex = `0x${BigInt(targetChain).toString(16)}`;
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainHex }] });
      } catch (error) {
        if (error.code !== 4902 || targetChain !== "31337") throw error;
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: targetChainHex,
            chainName: "Hardhat Local",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [rpcUrl],
          }],
        });
      }
      const walletChain = await injectedChainId();
      if (walletChain !== targetChain) throw new Error(`Wallet still reports chain ${walletChain} after switching.`);
      const provider = new BrowserProvider(window.ethereum, "any");
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      setWalletAddress(await signer.getAddress());
      setMethodStates((current) => Object.fromEntries(Object.entries(current).map(([key, state]) => [
        key,
        { ...state, error: /^Wallet reports chain/.test(state.error || "") ? "" : state.error },
      ])));
    } catch (error) {
      setWalletError(error.message || "Could not switch the wallet network.");
    } finally {
      setWalletBusy(false);
    }
  }

  async function readMethod(fragment) {
    const signature = signatureOf(fragment);
    setMethodState(signature, { error: "", result: "" });
    setBusyMethod(signature);
    try {
      const state = methodStates[signature] || {};
      const args = fragment.inputs.map((input, index) => parseArgument(state.args?.[index] || "", input));
      const provider = new JsonRpcProvider(rpcUrl);
      const contract = new Contract(address, abi, provider);
      const result = await contract[signature](...args);
      const formatted = normalizeResult(result);
      setMethodState(signature, { result: JSON.stringify(formatted, null, 2), error: "" });
    } catch (error) {
      setMethodState(signature, { error: error.shortMessage || error.message || "Read call failed.", result: "" });
    } finally {
      setBusyMethod("");
    }
  }

  async function writeMethod(event, fragment) {
    event.preventDefault();
    const signature = signatureOf(fragment);
    setMethodState(signature, { error: "", result: "" });
    if (!window.ethereum) {
      setMethodState(signature, { error: "No injected browser wallet is available." });
      return;
    }
    setBusyMethod(signature);
    try {
      const provider = new BrowserProvider(window.ethereum, "any");
      const walletChain = await injectedChainId();
      if (chainId && walletChain !== String(chainId)) {
        throw new Error(`Wallet reports chain ${walletChain}; switch it to chain ${chainId} before writing.`);
      }
      const signer = await provider.getSigner();
      const contract = new Contract(address, abi, signer);
      const state = methodStates[signature] || {};
      const args = fragment.inputs.map((input, index) => parseArgument(state.args?.[index] || "", input));
      const overrides = {};
      if (fragment.stateMutability === "payable" && state.value?.trim()) {
        overrides.value = parseEther(state.value.trim());
      }
      const transaction = await contract[signature](...args, ...(Object.keys(overrides).length ? [overrides] : []));
      setMethodState(signature, { result: `Transaction submitted: ${transaction.hash}\nWaiting for confirmation...`, error: "" });
      const receipt = await transaction.wait();
      setMethodState(signature, { result: `Transaction confirmed\nHash: ${receipt.hash}\nBlock: ${receipt.blockNumber}\nStatus: ${receipt.status === 1 ? "Success" : "Failed"}`, error: "" });
      setWalletAddress(await signer.getAddress());
    } catch (error) {
      const message = error.shortMessage || error.message || "Transaction failed.";
      setMethodState(signature, { error: message, result: "" });
      if (/^Wallet reports chain/.test(message)) setWalletError(message);
    } finally {
      setBusyMethod("");
    }
  }

  function renderArguments(fragment, signature) {
    return fragment.inputs.map((input, index) => <label className="contract-function-argument" key={`${signature}-${index}`}>
      <span>{input.name || `Argument ${index + 1}`} <small>{input.type}</small></span>
      <input value={methodStates[signature]?.args?.[index] || ""} onChange={(event) => {
        const current = methodStates[signature]?.args || [];
        const next = [...current];
        next[index] = event.target.value;
        setMethodState(signature, { args: next });
      }} placeholder={input.type.includes("[") || input.type.startsWith("tuple") ? "JSON value" : input.type} />
    </label>);
  }

  function renderFunction(fragment, isRead) {
    const signature = signatureOf(fragment);
    const state = methodStates[signature] || {};
    const busy = busyMethod === signature;
    return <article className="contract-function" key={signature}>
      <div className="contract-function-heading"><strong>{methodLabel(fragment)}</strong><span>{fragment.stateMutability}</span></div>
      <div className="contract-function-arguments">{renderArguments(fragment, signature)}</div>
      {!isRead && fragment.stateMutability === "payable" && <label className="contract-function-argument contract-payable-value"><span>Native value <small>entered in ether units</small></span><input inputMode="decimal" value={state.value || ""} onChange={(event) => setMethodState(signature, { value: event.target.value })} placeholder="0.0" /></label>}
      {state.error && <p className="contract-function-error" role="alert">{state.error}</p>}
      {state.result && <pre className="contract-function-result"><code>{state.result}</code></pre>}
      {isRead ? <button type="button" className="contract-function-button" onClick={() => void readMethod(fragment)} disabled={busy}>{busy ? <><LoaderCircle className="spin" size={14} /> Reading...</> : "Query"}</button> : <form onSubmit={(event) => void writeMethod(event, fragment)}><button type="submit" className="contract-function-button is-write" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={14} /> Sending...</> : "Write"}</button></form>}
    </article>;
  }

  const functions = activeTab === "read" ? readFunctions : writeFunctions;

  return <section className="contract-functions" aria-label={`${activeTab === "read" ? "Read" : "Write"} contract functions`}>
    <div className="contract-functions-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> CONTRACT INTERACTION</div><h3>{activeTab === "read" ? "Read Contract" : "Write Contract"}</h3></div>{activeTab === "write" && <div className="contract-wallet">
      {walletAddress ? <span title={walletAddress}><Wallet size={14} /> {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</span> : <button type="button" onClick={() => void connectWallet()} disabled={walletBusy}>{walletBusy ? <LoaderCircle className="spin" size={14} /> : <Wallet size={14} />}{walletBusy ? "Connecting" : "Connect wallet"}</button>}
    </div>}</div>
    {walletError && <div className="contract-wallet-error" role="alert"><span>{walletError}</span>{/^Wallet reports chain/.test(walletError) && <button type="button" onClick={() => void switchWalletNetwork()} disabled={walletBusy}>{walletBusy ? "Switching..." : `Switch wallet to chain ${chainId}`}</button>}</div>}
    <p className="contract-functions-note">{activeTab === "read" ? "Read calls use the selected RPC." : `Write calls require a wallet on chain ${chainId || "matching the contract"} and will request transaction approval.`}</p>
    <div className="contract-function-list">
      {functions.length
        ? functions.map((fragment) => renderFunction(fragment, activeTab === "read"))
        : <p className="contract-functions-empty">No {activeTab} functions are available in this contract ABI.</p>}
    </div>
  </section>;
}
