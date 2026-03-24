const { createClient } = require("@libsql/client");

// Use Turso in production (TURSO_DATABASE_URL), local SQLite file otherwise
const client = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: "file:db/fitness-proof.db" }
);

// Async helpers that mirror the old better-sqlite3 synchronous API
const db = {
  // Execute a write query (INSERT, UPDATE, CREATE, ALTER, etc.)
  async run(sql, params = []) {
    return client.execute({ sql, args: params });
  },
  // Fetch a single row
  async get(sql, params = []) {
    const result = await client.execute({ sql, args: params });
    return result.rows[0] || null;
  },
  // Fetch all rows
  async all(sql, params = []) {
    const result = await client.execute({ sql, args: params });
    return result.rows;
  },
};

// Run migrations on startup
async function initDatabase() {
  await db.run(`
    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      anonId TEXT,
      folder TEXT,
      filename TEXT,
      size INTEGER,
      uploadedAt TEXT,
      blobId TEXT,
      commitment TEXT,
      txHash TEXT,
      walletAddress TEXT,
      activityType TEXT,
      activityTitle TEXT,
      activityDistance REAL,
      activityDuration INTEGER,
      activityCalories INTEGER,
      activityHeartRate INTEGER,
      activityNotes TEXT
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      username TEXT UNIQUE,
      passwordHash TEXT,
      walletAddress TEXT,
      createdAt TEXT
    )
  `);

  // Migration-safe column additions
  const addColumnSafe = async (table, column, type) => {
    try { await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); } catch (_) {}
  };

  await addColumnSafe("uploads", "blobId", "TEXT");
  await addColumnSafe("uploads", "commitment", "TEXT");
  await addColumnSafe("uploads", "txHash", "TEXT");
  await addColumnSafe("uploads", "walletAddress", "TEXT");
  await addColumnSafe("uploads", "userId", "INTEGER");
  await addColumnSafe("users", "walletAddress", "TEXT");
  await addColumnSafe("uploads", "activityType", "TEXT");
  await addColumnSafe("uploads", "activityTitle", "TEXT");
  await addColumnSafe("uploads", "activityDistance", "REAL");
  await addColumnSafe("uploads", "activityDuration", "INTEGER");
  await addColumnSafe("uploads", "activityCalories", "INTEGER");
  await addColumnSafe("uploads", "activityHeartRate", "INTEGER");
  await addColumnSafe("uploads", "activityNotes", "TEXT");

  console.log("Database initialized:", process.env.TURSO_DATABASE_URL ? "Turso (remote)" : "local SQLite");
}

module.exports = { db, initDatabase };
