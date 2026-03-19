const fs = require("fs/promises");
const path = require("path");

async function uploadToShelby(filePath) {
  try {
    const { default: shelbyClient } = await import("../shelby/client.mjs");
    const { generateCommitments } = await import("@shelby-protocol/sdk/node");
    const { Ed25519Account, Ed25519PrivateKey } = await import("@aptos-labs/ts-sdk");

    // Get credentials from environment
    const privateKeyString = process.env.SHELBY_PRIVATE_KEY;

    if (!privateKeyString) {
      throw new Error("SHELBY_PRIVATE_KEY environment variable is required");
    }

    // Create account from private key (expects "ed25519-priv-..." format)
    const privateKey = new Ed25519PrivateKey(privateKeyString);
    const signer = new Ed25519Account({ privateKey });

    // Read file and prepare blob data
    const blobData = await fs.readFile(filePath);
    const blobName = "fitness-proof/" + path.basename(filePath);
    const expirationMicros = (1000 * 60 * 60 * 24 * 30 + Date.now()) * 1000; // 30 days

    // Step 1: Generate commitments
    const provider = await shelbyClient.getProvider();
    const blobCommitments = await generateCommitments(provider, blobData);

    // Step 2: Register blob on coordination layer (if not already registered)
    const existingMetadata = await shelbyClient.coordination.getBlobMetadata({
      account: signer.accountAddress,
      name: blobName,
    });

    let txHash = null;
    if (!existingMetadata) {
      const { transaction: pendingTx } = await shelbyClient.coordination.registerBlob({
        account: signer,
        blobName,
        blobMerkleRoot: blobCommitments.blob_merkle_root,
        size: blobData.length,
        expirationMicros,
        config: provider.config,
      });

      await shelbyClient.coordination.aptos.waitForTransaction({
        transactionHash: pendingTx.hash,
      });
      txHash = pendingTx.hash;
    }

    // Step 3: Upload blob data to RPC storage layer
    await shelbyClient.rpc.putBlob({
      account: signer.accountAddress,
      blobName,
      blobData,
    });

    return {
      provider: "shelby",
      status: "stored",
      blobId: blobName,
      commitment: txHash || blobCommitments.blob_merkle_root,
    };

  } catch (err) {
    console.error("Shelby upload failed:", err.message || err);
    return {
      provider: "shelby",
      status: "failed",
      error: err.message || "Unknown error"
    };
  }
}

module.exports = uploadToShelby;