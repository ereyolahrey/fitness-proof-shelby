import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";
import { Network } from "@aptos-labs/ts-sdk";

const config = {
  network: Network.TESTNET
};

// Add API key if available (get one free from https://docs.shelby.xyz/sdks/typescript/acquire-api-keys)
if (process.env.SHELBY_API_KEY) {
  config.apiKey = process.env.SHELBY_API_KEY;
}

const shelbyClient = new ShelbyNodeClient(config);

export default shelbyClient;