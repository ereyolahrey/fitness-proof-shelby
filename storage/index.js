const localStorage = require("./local");
const shelbyStorage = require("./shelby");

// Toggle storage provider here
const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || "local";

async function storeFile({ filePath }) {
  if (STORAGE_PROVIDER === "shelby") {
    return shelbyStorage.storeFile({ filePath });
  }

  return localStorage.storeFile({ filePath });
}

module.exports = {
  storeFile
};
console.log("STORAGE PROVIDER:", STORAGE_PROVIDER);
