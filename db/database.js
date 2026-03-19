const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "fitness-proof.db");
const db = new Database(dbPath);

// Create uploads table if it doesn't exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    anonId TEXT,
    folder TEXT,
    filename TEXT,
    size INTEGER,
    uploadedAt TEXT
  )
`).run();

// Create users table
db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  passwordHash TEXT,
  walletAddress TEXT,
  createdAt TEXT
)
`).run();

// Add columns if they don't exist (migration-safe)
const addColumnSafe = (table, column, type) => {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run(); } catch (e) {}
};

addColumnSafe("uploads", "blobId", "TEXT");
addColumnSafe("uploads", "commitment", "TEXT");
addColumnSafe("uploads", "txHash", "TEXT");
addColumnSafe("uploads", "walletAddress", "TEXT");
addColumnSafe("uploads", "userId", "INTEGER");

module.exports = db;
