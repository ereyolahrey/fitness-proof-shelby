async function storeFile({ filePath }) {
  return {
    provider: "local",
    status: "stored",
    note: "File kept on local filesystem"
  };
}

module.exports = {
  storeFile
};
