require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("../db/database");

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.JWT_SECRET) {
  console.warn("WARNING: JWT_SECRET not set in environment. A random secret was generated.");
  console.warn("All tokens will be invalidated on server restart. Set JWT_SECRET in your .env file.");
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

//  Upload directory 
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..");
const uploadDir = path.join(dataDir, "uploads", "temp");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use("/uploads", express.static(path.join(dataDir, "uploads")));

//  Multer config 
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) cb(null, true);
  else cb(new Error("Only image files allowed"), false);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

//  JWT Auth Middleware 
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

//  Auth Routes 
app.post("/auth/signup", async (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    db.prepare(
      "INSERT INTO users (email, username, passwordHash, createdAt) VALUES (?, ?, ?, ?)"
    ).run(email.trim(), username.trim(), passwordHash, new Date().toISOString());
    res.json({ message: "Account created" });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return res.status(400).json({ error: "Email or username already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim());
  if (!user) return res.status(400).json({ error: "User not found" });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(400).json({ error: "Invalid password" });

  const token = jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
  res.json({
    token,
    user: { id: user.id, email: user.email, username: user.username, walletAddress: user.walletAddress }
  });
});

// Token validation endpoint — lets frontend check if stored token is still valid
app.get("/auth/validate", authenticate, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(401).json({ error: "User no longer exists" });
  res.json({ valid: true, user: { id: user.id, email: user.email, username: user.username, walletAddress: user.walletAddress || null } });
});

app.post("/auth/wallet", authenticate, (req, res) => {
  const { walletAddress } = req.body;
  db.prepare("UPDATE users SET walletAddress = ? WHERE id = ?").run(walletAddress || null, req.user.id);
  res.json({ message: "Wallet updated" });
});

//  In-memory pending uploads (keyed by uploadId) 
const pendingUploads = new Map();

// Clean up stale pending uploads every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of pendingUploads) {
    if (now - data.createdAt > 15 * 60 * 1000) {
      try { fs.unlinkSync(data.filePath); } catch (_) {}
      pendingUploads.delete(id);
    }
  }
}, 10 * 60 * 1000);

//  Upload: Step 1 - Prepare 
// Accepts file, generates Shelby commitments, returns tx payload for wallet signing
app.post("/upload/prepare", authenticate, upload.single("photo"), async (req, res) => {
  // Photo is optional for activity logging

  const walletAddress = req.body.walletAddress;
  if (!walletAddress) return res.status(400).json({ error: "Wallet address is required" });

  const folder = req.body.folder || "Unsorted";

  try {
    const { generateCommitments, ShelbyNodeClient, expectedTotalChunksets, defaultErasureCodingConfig, SHELBY_DEPLOYER } = await import("@shelby-protocol/sdk/node");
    const { Network, Hex } = await import("@aptos-labs/ts-sdk");

    // Create a shelby client for commitments generation
    const config = { network: Network.TESTNET };
    if (process.env.SHELBY_API_KEY) config.apiKey = process.env.SHELBY_API_KEY;
    const shelbyClient = new ShelbyNodeClient(config);

    // Build blob data from file or activity JSON
    let blobData, blobName;
    if (req.file) {
      blobData = fs.readFileSync(req.file.path);
      blobName = "fitness-proof/" + req.file.filename;
    } else {
      // No file — create a JSON blob from activity data
      const activityJson = JSON.stringify({
        type: req.body.activityType || "workout",
        title: req.body.activityTitle || "Activity",
        distance: parseFloat(req.body.activityDistance) || 0,
        duration: parseInt(req.body.activityDuration) || 0,
        calories: parseInt(req.body.activityCalories) || 0,
        heartRate: parseInt(req.body.activityHeartRate) || 0,
        notes: req.body.activityNotes || "",
        timestamp: new Date().toISOString()
      });
      blobData = Buffer.from(activityJson, "utf-8");
      blobName = "fitness-proof/activity_" + Date.now() + ".json";
    }
    const expirationMicros = (1000 * 60 * 60 * 24 * 30 + Date.now()) * 1000; // 30 days

    const provider = await shelbyClient.getProvider();
    const blobCommitments = await generateCommitments(provider, blobData);
    const erasureConfig = provider.config || defaultErasureCodingConfig();
    const chunksetSize = erasureConfig.chunkSizeBytes * erasureConfig.erasure_k;
    const numChunksets = expectedTotalChunksets(blobData.length, chunksetSize);

    // Build the Move entry function payload for wallet signing
    const txPayload = {
      function: SHELBY_DEPLOYER.toString() + "::blob_metadata::register_blob",
      functionArguments: [
        blobName,
        expirationMicros.toString(),
        Array.from(Hex.fromHexString(blobCommitments.blob_merkle_root).toUint8Array()),
        numChunksets,
        blobData.length,
        0,
        erasureConfig.enumIndex || 0
      ]
    };

    // Store pending upload data
    const uploadId = crypto.randomBytes(16).toString("hex");
    pendingUploads.set(uploadId, {
      filePath: req.file ? req.file.path : null,
      filename: req.file ? req.file.filename : blobName.split("/").pop(),
      size: req.file ? req.file.size : blobData.length,
      folder,
      userId: req.user.id,
      walletAddress,
      blobName,
      blobData,
      blobCommitments,
      expirationMicros,
      shelbyClient,
      provider,
      activityType: req.body.activityType || null,
      activityTitle: req.body.activityTitle || null,
      activityDistance: parseFloat(req.body.activityDistance) || 0,
      activityDuration: parseInt(req.body.activityDuration) || 0,
      activityCalories: parseInt(req.body.activityCalories) || 0,
      activityHeartRate: parseInt(req.body.activityHeartRate) || 0,
      activityNotes: req.body.activityNotes || null,
      createdAt: Date.now()
    });

    res.json({
      uploadId,
      blobName,
      txPayload,
      message: "Ready for wallet signing"
    });
  } catch (err) {
    console.error("Prepare upload error:", err);
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
    res.status(500).json({ error: "Failed to prepare upload: " + err.message });
  }
});

//  Upload: Step 2 - Confirm 
// After user signs tx in wallet, confirm and upload blob to Shelby RPC
app.post("/upload/confirm", authenticate, async (req, res) => {
  const { uploadId, txHash, blobName } = req.body;
  if (!uploadId || !txHash) {
    return res.status(400).json({ error: "uploadId and txHash are required" });
  }

  const pending = pendingUploads.get(uploadId);
  if (!pending) return res.status(404).json({ error: "Upload not found or expired" });
  if (pending.userId !== req.user.id) return res.status(403).json({ error: "Unauthorized" });

  try {
    // Wait for the user's transaction to confirm on-chain
    await pending.shelbyClient.coordination.aptos.waitForTransaction({ transactionHash: txHash });

    // Upload blob data to Shelby RPC storage layer
    const { AccountAddress } = await import("@aptos-labs/ts-sdk");
    await pending.shelbyClient.rpc.putBlob({
      account: AccountAddress.from(pending.walletAddress),
      blobName: pending.blobName,
      blobData: pending.blobData,
    });

    // Save to database
    const uploadedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO uploads (userId, anonId, folder, filename, size, uploadedAt, blobId, commitment, txHash, walletAddress,
       activityType, activityTitle, activityDistance, activityDuration, activityCalories, activityHeartRate, activityNotes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.user.id,
      req.user.username,
      pending.folder,
      pending.filename,
      pending.size,
      uploadedAt,
      pending.blobName,
      pending.blobCommitments.blob_merkle_root,
      txHash,
      pending.walletAddress,
      pending.activityType,
      pending.activityTitle,
      pending.activityDistance,
      pending.activityDuration,
      pending.activityCalories,
      pending.activityHeartRate,
      pending.activityNotes
    );

    // Keep local photo file on persistent disk for progress photo display
    pendingUploads.delete(uploadId);

    res.json({
      message: "Upload verified on-chain",
      blobId: pending.blobName,
      commitment: pending.blobCommitments.blob_merkle_root,
      txHash,
      folder: pending.folder
    });
  } catch (err) {
    console.error("Confirm upload error:", err);
    res.status(500).json({ error: "Failed to confirm upload: " + err.message });
  }
});

//  Legacy upload (backward compat) 
app.post("/upload", upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No photo uploaded" });
  const folder = req.body.folder || "Unsorted";
  const anonId = req.body.anonId || "anon_" + crypto.randomBytes(8).toString("hex");
  const uploadedAt = new Date().toISOString();

  let storageResult;
  try {
    const { storeFile } = require("../storage");
    storageResult = await storeFile({ filePath: req.file.path });
  } catch (err) {
    return res.status(500).json({ error: "Storage failed", details: err.message });
  }

  if (storageResult.provider === "shelby" && storageResult.status === "stored") {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
  }

  db.prepare(
    "INSERT INTO uploads (anonId, folder, filename, size, uploadedAt, blobId, commitment) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(anonId, folder, req.file.filename, req.file.size, uploadedAt, storageResult.blobId || null, storageResult.commitment || null);

  res.json({ message: "Photo uploaded", anonId, folder, uploadedAt, storage: storageResult });
});

//  Stats (authenticated) 
app.get("/stats", authenticate, (req, res) => {
  const row = db.prepare(
    `SELECT COUNT(*) as totalActivities,
     COALESCE(SUM(activityDistance), 0) as totalDistance,
     COUNT(CASE WHEN txHash IS NOT NULL THEN 1 END) as onChainCount
     FROM uploads WHERE userId = ?`
  ).get(req.user.id);

  // Calculate streak: consecutive days with at least one activity
  const days = db.prepare(
    `SELECT DISTINCT DATE(uploadedAt) as d FROM uploads WHERE userId = ? ORDER BY d DESC`
  ).all(req.user.id).map(r => r.d);
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < days.length; i++) {
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    const expectedStr = expected.toISOString().split("T")[0];
    if (days[i] === expectedStr) streak++;
    else break;
  }

  res.json({ ...row, currentStreak: streak });
});

//  Timeline (authenticated) 
app.get("/timeline", authenticate, (req, res) => {
  const rows = db.prepare(
    `SELECT folder, filename, size, uploadedAt, blobId, commitment, txHash, walletAddress,
     activityType, activityTitle, activityDistance, activityDuration, activityCalories, activityHeartRate, activityNotes
     FROM uploads WHERE userId = ? ORDER BY uploadedAt DESC`
  ).all(req.user.id);

  const uploads = rows.map(row => ({
    folder: row.folder,
    filename: row.filename,
    size: row.size,
    uploadedAt: row.uploadedAt,
    blobId: row.blobId,
    commitment: row.commitment,
    txHash: row.txHash,
    walletAddress: row.walletAddress,
    activityType: row.activityType,
    activityTitle: row.activityTitle,
    activityDistance: row.activityDistance,
    activityDuration: row.activityDuration,
    activityCalories: row.activityCalories,
    activityHeartRate: row.activityHeartRate,
    activityNotes: row.activityNotes,
    hasFile: fs.existsSync(path.join(uploadDir, row.filename))
  }));

  res.json({ uploads });
});

//  Legacy timeline (by anonId) 
app.get("/timeline/:anonId", (req, res) => {
  const rows = db.prepare(
    "SELECT folder, filename, size, uploadedAt, blobId, commitment, txHash FROM uploads WHERE anonId = ? ORDER BY uploadedAt ASC"
  ).all(req.params.anonId);
  res.json({ anonId: req.params.anonId, uploads: rows });
});

//  Verify route 
app.get("/verify/:blobId", (req, res) => {
  const row = db.prepare(
    "SELECT anonId, folder, filename, uploadedAt, blobId, commitment, txHash FROM uploads WHERE blobId = ?"
  ).get(req.params.blobId);
  if (!row) return res.status(404).json({ status: "not_found" });
  res.json({
    status: row.commitment ? "verified" : "unverified",
    proof: { blobId: row.blobId, commitment: row.commitment, txHash: row.txHash },
    upload: { folder: row.folder, filename: row.filename, uploadedAt: row.uploadedAt }
  });
});

//  Health check (for Render) 
app.get("/health", (req, res) => res.json({ status: "ok" }));

//  Debug 
app.get("/debug/uploads", (req, res) => {
  res.json(db.prepare("SELECT * FROM uploads").all());
});

//  Start 
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Fitness Proof server running on http://localhost:" + PORT);
  console.log("Storage provider:", process.env.STORAGE_PROVIDER || "local");
});
