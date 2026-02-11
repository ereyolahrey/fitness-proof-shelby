const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "fitness-proof.db");
const db = new Database(dbPath);

// Create uploads table if it doesn't exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anonId TEXT,
    folder TEXT,
    filename TEXT,
    size INTEGER,
    uploadedAt TEXT
  )
`).run();
// Add Shelby proof columns if they don't exist
try {
  db.prepare(`ALTER TABLE uploads ADD COLUMN blobId TEXT`).run();
} catch (e) {}

try {
  db.prepare(`ALTER TABLE uploads ADD COLUMN commitment TEXT`).run();
} catch (e) {}

module.exports = db;
