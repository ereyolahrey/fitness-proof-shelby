const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Use persistent disk in production (DATA_DIR env), local dir otherwise
const dataDir = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, "fitness-proof.db");
const db = new Database(dbPath);
console.log("Database path:", dbPath);

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

// Users table migrations
addColumnSafe("users", "walletAddress", "TEXT");

// Activity metadata columns
addColumnSafe("uploads", "activityType", "TEXT");
addColumnSafe("uploads", "activityTitle", "TEXT");
addColumnSafe("uploads", "activityDistance", "REAL");
addColumnSafe("uploads", "activityDuration", "INTEGER");
addColumnSafe("uploads", "activityCalories", "INTEGER");
addColumnSafe("uploads", "activityHeartRate", "INTEGER");
addColumnSafe("uploads", "activityNotes", "TEXT");

module.exports = db;
