import { ContractFactory, JsonRpcProvider } from "ethers";
import { readFile } from "node:fs/promises";

const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const provider = new JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();

if (network.chainId !== 31337n) {
  throw new Error(`Refusing to deploy: expected local chain 31337, received ${network.chainId}`);
}

const [deployerAddress] = await provider.send("eth_accounts", []);
if (!deployerAddress) {
  throw new Error("No unlocked Hardhat account found. Is the local node running?");
}

const signer = await provider.getSigner(deployerAddress);
const artifactPath = new URL("../artifacts/contracts/LocalBEP20.sol/LocalBEP20.json", import.meta.url);
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const token = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy();

await token.waitForDeployment();
console.log(`LocalBEP20 deployed to: ${await token.getAddress()}`);
console.log(`Deployer: ${deployerAddress}`);

await provider.destroy();