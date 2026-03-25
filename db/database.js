const isPostgres = !!process.env.DATABASE_URL;

// ── SQL transformations for PostgreSQL compatibility ──

// Quote camelCase identifiers so PG preserves their case
function quoteCamelCase(sql) {
  if (!isPostgres) return sql;
  return sql.replace(/\b([a-z][a-zA-Z]*[A-Z][a-zA-Z]*)\b/g, '"$1"');
}

// Convert ? placeholders to $1, $2, ... for PG
function convertParams(sql) {
  if (!isPostgres) return sql;
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function prepareSql(sql) {
  return convertParams(quoteCamelCase(sql));
}

// ── Backend setup ──

let pgSql, libsqlClient;

if (isPostgres) {
  const { neon } = require("@neondatabase/serverless");
  pgSql = neon(process.env.DATABASE_URL, { fullResults: true });
} else {
  const { createClient } = require("@libsql/client");
  libsqlClient = createClient({ url: "file:db/fitness-proof.db" });
}

async function rawQuery(sql, params = []) {
  if (isPostgres) {
    // Use .query() for conventional parameterized queries ($1, $2, ...)
    return pgSql.query(sql, params);
  }
  return libsqlClient.execute({ sql, args: params });
}

// ── Public API (same interface for both backends) ──

const db = {
  async run(sql, params = []) {
    return rawQuery(prepareSql(sql), params);
  },
  async get(sql, params = []) {
    const result = await rawQuery(prepareSql(sql), params);
    return result.rows[0] || null;
  },
  async all(sql, params = []) {
    const result = await rawQuery(prepareSql(sql), params);
    return result.rows;
  },
};

// ── Migrations ──

async function initDatabase() {
  if (isPostgres) {
    // PostgreSQL schema (SERIAL, quoted camelCase columns)
    await rawQuery(`
      CREATE TABLE IF NOT EXISTS uploads (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER,
        "anonId" TEXT,
        folder TEXT,
        filename TEXT,
        size INTEGER,
        "uploadedAt" TEXT,
        "blobId" TEXT,
        commitment TEXT,
        "txHash" TEXT,
        "walletAddress" TEXT,
        "activityType" TEXT,
        "activityTitle" TEXT,
        "activityDistance" REAL,
        "activityDuration" INTEGER,
        "activityCalories" INTEGER,
        "activityHeartRate" INTEGER,
        "activityNotes" TEXT
      )
    `);
    await rawQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE,
        username TEXT UNIQUE,
        "passwordHash" TEXT,
        "walletAddress" TEXT,
        "createdAt" TEXT
      )
    `);
  } else {
    // SQLite schema (AUTOINCREMENT, unquoted columns)
    await rawQuery(`
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
    await rawQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        username TEXT UNIQUE,
        passwordHash TEXT,
        walletAddress TEXT,
        createdAt TEXT
      )
    `);
  }

  // Migration-safe column additions
  const addColumnSafe = async (table, column, type) => {
    try {
      if (isPostgres) {
        await rawQuery(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "${column}" ${type}`);
      } else {
        await rawQuery(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    } catch (_) {}
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

  console.log("Database initialized:", isPostgres ? "Neon PostgreSQL (remote)" : "local SQLite");
}

module.exports = { db, initDatabase };
