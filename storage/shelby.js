const crypto = require("crypto");

async function storeFile({ filePath }) {
  // Simulate network / processing delay
  await new Promise(res => setTimeout(res, 300));

  const blobId = "mock_" + crypto.randomBytes(6).toString("hex");
  const commitment = "mock_commitment_" + crypto.randomBytes(8).toString("hex");

  return {
    provider: "shelby",
    status: "stored",
    blobId,
    commitment
  };
}

module.exports = {
  storeFile
};
