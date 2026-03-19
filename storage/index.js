const uploadToShelby = require("../shelby/upload");
const localStorage = require("./local");

const provider = process.env.STORAGE_PROVIDER || "local";

console.log("STORAGE PROVIDER:", provider);

async function storeFile(options) {
  const filePath = options.filePath;

  if (provider === "shelby") {
    return await uploadToShelby(filePath);
  }

  return localStorage.storeFile(options);
}

module.exports = { storeFile };