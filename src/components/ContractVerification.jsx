import { useEffect, useState } from "react";
import { BadgeCheck, ChevronDown, Code2, FilePlus2, LoaderCircle, Plus, Trash2 } from "lucide-react";
import ContractFunctions from "./ContractFunctions.jsx";

function endpointBase(value) {
  return value.trim().replace(/\/+$/, "");
}

async function responseJson(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Verifier request failed (${response.status}).`);
  return result;
}

export default function ContractVerification({ address, detected, rpcUrl, apiUrl, chainId }) {
  const [verification, setVerification] = useState(null);
  const [verifiedTab, setVerifiedTab] = useState("code");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [supportedVersions, setSupportedVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [versionsError, setVersionsError] = useState("");
  const [compilerVersion, setCompilerVersion] = useState("0.8.25");
  const [contractFile, setContractFile] = useState("contracts/Contract.sol");
  const [contractName, setContractName] = useState("");
  const [optimizerEnabled, setOptimizerEnabled] = useState(false);
  const [optimizerRuns, setOptimizerRuns] = useState("200");
  const [viaIR, setViaIR] = useState(false);
  const [evmVersion, setEvmVersion] = useState("");
  const [metadataBytecodeHash, setMetadataBytecodeHash] = useState("ipfs");
  const [sourceFiles, setSourceFiles] = useState([{ path: "contracts/Contract.sol", content: "" }]);

  useEffect(() => {
    setVerifiedTab("code");
  }, [address]);

  useEffect(() => {
    if (!apiUrl.trim()) {
      setSupportedVersions([]);
      setVersionsLoading(false);
      setVersionsError("Set the PHP verifier API URL in Network settings first.");
      return undefined;
    }

    const controller = new AbortController();
    setVersionsLoading(true);
    setVersionsError("");
    fetch(`${endpointBase(apiUrl)}/versions`, { signal: controller.signal })
      .then(responseJson)
      .then((result) => {
        const versions = Array.isArray(result.versions) ? result.versions.filter((version) => typeof version === "string") : [];
        setSupportedVersions(versions);
        setCompilerVersion((current) => versions.includes(current)
          ? current
          : versions.includes(result.defaultVersion) ? result.defaultVersion : versions[0] || "");
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setSupportedVersions([]);
          setVersionsError(error.message || "Could not load installed compiler versions.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setVersionsLoading(false);
      });
    return () => controller.abort();
  }, [apiUrl]);

  useEffect(() => {
    if (!detected || !address || !rpcUrl || !apiUrl.trim()) {
      setVerification(null);
      setLookupBusy(false);
      setLookupError("");
      return undefined;
    }

    const controller = new AbortController();
    const base = endpointBase(apiUrl);
    const query = new URLSearchParams({ address, rpcUrl });
    setLookupBusy(true);
    setLookupError("");
    fetch(`${base}/contract?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) {
          setVerification(null);
          return;
        }
        const result = await responseJson(response);
        setVerification(result.verified ? result : null);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setVerification(null);
          setLookupError(error.message || "Could not check saved verification.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLookupBusy(false);
      });

    return () => controller.abort();
  }, [address, apiUrl, chainId, detected, refreshKey, rpcUrl]);

  async function submitVerification(event) {
    event.preventDefault();
    setSubmitError("");
    setSubmitMessage("");
    if (!apiUrl.trim()) {
      setSubmitError("Set the PHP verifier API URL in Network settings first.");
      return;
    }
    if (!contractName.trim()) {
      setSubmitError("Enter the contract name from the submitted source.");
      return;
    }
    const sources = {};
    for (const source of sourceFiles) {
      const path = source.path.trim();
      if (!path || !source.content.trim()) {
        setSubmitError("Every source file needs a relative .sol path and source code.");
        return;
      }
      if (Object.hasOwn(sources, path)) {
        setSubmitError(`Source path ${path} is duplicated.`);
        return;
      }
      sources[path] = source.content;
    }
    if (!Object.hasOwn(sources, selectedContractFile)) {
      setSubmitError("Select the source file containing the contract.");
      return;
    }

    const body = {
      rpcUrl,
      address,
      compilerVersion: compilerVersion.trim(),
      contractFile: selectedContractFile,
      contractName: contractName.trim(),
      optimizer: { enabled: optimizerEnabled, runs: Number(optimizerRuns) || 200 },
      viaIR,
      metadataBytecodeHash,
      sources,
    };
    if (evmVersion.trim()) body.evmVersion = evmVersion.trim();

    setSubmitting(true);
    try {
      const response = await fetch(`${endpointBase(apiUrl)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await responseJson(response);
      if (!result.verified) throw new Error("The backend did not confirm this source as verified.");
      setSubmitMessage("Source verified against the deployed contract bytecode.");
      setFormOpen(false);
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setSubmitError(error.message || "Verification request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function updateSource(index, field, value) {
    setSourceFiles((files) => files.map((file, fileIndex) => {
      if (fileIndex !== index) return file;
      if (field === "path" && file.path === contractFile) setContractFile(value);
      return { ...file, [field]: value };
    }));
  }

  if (!detected) return null;

  const selectedContractFile = sourceFiles.some((file) => file.path === contractFile) ? contractFile : sourceFiles[0]?.path || "";

  return <section className="contract-verification" aria-labelledby="verification-heading">
    <div className="verification-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-line" /> CONTRACT SOURCE</div>
        <h2 id="verification-heading">{verification ? "Verified contract" : "Contract verification"}</h2>
      </div>
      <span className={`verification-status${verification ? " is-verified" : ""}`}>
        {verification ? <BadgeCheck size={15} /> : <Code2 size={15} />}
        {lookupBusy ? "CHECKING" : verification ? "VERIFIED" : "UNVERIFIED"}
      </span>
    </div>

    {lookupError && <p className="verification-notice" role="status">Could not check saved source: {lookupError}</p>}
    {verification ? <>
      <nav className="verified-contract-tabs" role="tablist" aria-label="Verified contract">
        <button type="button" role="tab" aria-selected={verifiedTab === "code"} aria-controls="verified-contract-panel" className={verifiedTab === "code" ? "is-active" : ""} onClick={() => setVerifiedTab("code")}><Code2 size={15} /> Code</button>
        <button type="button" role="tab" aria-selected={verifiedTab === "read"} aria-controls="verified-contract-panel" className={verifiedTab === "read" ? "is-active" : ""} onClick={() => setVerifiedTab("read")}>Read Contract</button>
        <button type="button" role="tab" aria-selected={verifiedTab === "write"} aria-controls="verified-contract-panel" className={verifiedTab === "write" ? "is-active" : ""} onClick={() => setVerifiedTab("write")}>Write Contract</button>
      </nav>
      <div id="verified-contract-panel" className="verified-source" role="tabpanel">
        {verifiedTab === "code" ? <>
          <div className="verified-source-meta">
            <strong>{verification.contractName}</strong>
            <span>Solidity {verification.compilerVersion}</span>
            <span>Verified {verification.verifiedAt ? new Date(`${verification.verifiedAt.replace(" ", "T")}Z`).toLocaleString() : ""}</span>
          </div>
          {Object.entries(verification.sources || {}).map(([path, source]) => <details className="verified-source-file" key={path} open>
            <summary><Code2 size={14} /> {path}<ChevronDown size={14} /></summary>
            <pre><code>{source}</code></pre>
          </details>)}
          <details className="verified-source-file verified-contract-abi">
            <summary><Code2 size={14} /> Contract ABI<ChevronDown size={14} /></summary>
            <pre><code>{JSON.stringify(verification.abi || [], null, 2)}</code></pre>
          </details>
          <p className="verification-footnote">Source is shown only while this chain, address, and deployed bytecode match the saved verification.</p>
        </> : <ContractFunctions address={address} abi={verification.abi || []} rpcUrl={rpcUrl} chainId={chainId} activeTab={verifiedTab} />}
      </div>
    </> : <>
      <p className="verification-copy">Submit the Solidity source and deployment compiler settings. The backend verifies a bytecode match before saving or showing the source.</p>
      {!formOpen ? <button className="verification-open-button" type="button" onClick={() => setFormOpen(true)}><Code2 size={16} /> Verify contract</button> : <form className="verification-form" onSubmit={submitVerification}>
        <div className="verification-fields">
          <label>Contract name<input value={contractName} onChange={(event) => setContractName(event.target.value)} placeholder="ExampleToken" required /></label>
          <label>Compiler version<select value={compilerVersion} onChange={(event) => setCompilerVersion(event.target.value)} required disabled={versionsLoading || supportedVersions.length === 0}>
            {versionsLoading ? <option value={compilerVersion}>Loading available versions...</option> : supportedVersions.length
              ? supportedVersions.map((version) => <option value={version} key={version}>Solidity {version}</option>)
              : <option value="">No compiler versions available</option>}
          </select></label>
          <label>EVM version<input value={evmVersion} onChange={(event) => setEvmVersion(event.target.value)} placeholder="Default compiler target" /></label>
        </div>
        {versionsError && <p className="verification-notice" role="status">{versionsError}</p>}
        {!versionsError && supportedVersions.length > 0 && <p className="verification-version-note">Available Solidity versions: {supportedVersions.join(", ")}. To add a Remix compiler version, install that exact `solc` version on the PHP server and map it in `SOLC_BINARIES`.</p>}
        <div className="verification-toggles">
          <label><input type="checkbox" checked={optimizerEnabled} onChange={(event) => setOptimizerEnabled(event.target.checked)} /> Optimizer enabled</label>
          <label>Optimizer runs<input type="number" min="1" max="1000000" value={optimizerRuns} onChange={(event) => setOptimizerRuns(event.target.value)} disabled={!optimizerEnabled} /></label>
          <label><input type="checkbox" checked={viaIR} onChange={(event) => setViaIR(event.target.checked)} /> Compile via IR</label>
          <label>Metadata hash<select value={metadataBytecodeHash} onChange={(event) => setMetadataBytecodeHash(event.target.value)}><option value="ipfs">IPFS</option><option value="bzzr1">Swarm (bzzr1)</option><option value="none">None</option></select></label>
        </div>
        <div className="verification-source-list">
          <div className="verification-source-heading"><strong>Solidity source files</strong><button type="button" className="verification-secondary-button" onClick={() => setSourceFiles((files) => [...files, { path: `contracts/Import${files.length}.sol`, content: "" }])}><Plus size={14} /> Add file</button></div>
          {sourceFiles.map((file, index) => <fieldset className="verification-source-file-input" key={index}>
            <div className="verification-source-file-bar"><div className="verification-source-file-controls"><label className="verification-main-file"><input type="radio" name="main-contract-file" checked={selectedContractFile === file.path} onChange={() => setContractFile(file.path)} disabled={!file.path.trim()} /> Main contract source</label><label>Relative file path<input value={file.path} onChange={(event) => updateSource(index, "path", event.target.value)} placeholder="mytest/testtoken.sol" required /><small className="verification-path-hint">Editable. Use the exact Remix project-relative path, such as `mytest/testtoken.sol`; renaming the selected file updates the main source selection.</small></label></div>{sourceFiles.length > 1 && <button type="button" className="verification-remove-button" onClick={() => setSourceFiles((files) => files.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Remove ${file.path}`} title="Remove source file"><Trash2 size={15} /></button>}</div>
            <textarea value={file.content} onChange={(event) => updateSource(index, "content", event.target.value)} spellCheck="false" placeholder="Paste the complete Solidity source, including imports when applicable." rows={10} />
          </fieldset>)}
        </div>
        {submitError && <p className="verification-error" role="alert">{submitError}</p>}
        {submitMessage && <p className="verification-success" role="status">{submitMessage}</p>}
        <div className="verification-actions"><button type="button" className="verification-secondary-button" onClick={() => { setFormOpen(false); setSubmitError(""); }}>Cancel</button><button type="submit" className="verification-submit-button" disabled={submitting || versionsLoading || !compilerVersion}>{submitting ? <><LoaderCircle className="spin" size={15} /> Compiling and checking...</> : <><FilePlus2 size={15} /> Submit for verification</>}</button></div>
      </form>}
    </>}
  </section>;
}
