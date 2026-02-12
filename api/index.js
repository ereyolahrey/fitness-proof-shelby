const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const db = require("../db/database");
const { storeFile } = require("../storage");


const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));



// Ensure upload directory exists
const uploadDir = "uploads/temp";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Generate anonymous user ID
function generateAnonId() {
  return "anon_" + crypto.randomBytes(8).toString("hex");
}

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

// Allow only images
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files allowed"), false);
  }
};

const upload = multer({ storage, fileFilter });

// Health check
app.get("/", (req, res) => {
  res.send("Fitness Proof API is running");
});

// Upload endpoint
app.post("/upload", upload.single("photo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No photo uploaded" });
  }

  const folder = req.body.folder || "Unsorted";
  const anonId = req.body.anonId || generateAnonId();
  const uploadedAt = new Date().toISOString();

  // Store file via storage layer
  const storageResult = await storeFile({
  filePath: req.file.path
});

// Delete local file ONLY if Shelby stored it successfully
if (
  storageResult.provider === "shelby" &&
  storageResult.status === "stored"
) {
  try {
    fs.unlinkSync(req.file.path);
  } catch (err) {
    console.error("Failed to delete local file:", err.message);
  }
}


  let blobId = null;
  let commitment = null;

  if (storageResult.provider === "shelby" && storageResult.status === "stored") {
    blobId = storageResult.blobId;
    commitment = storageResult.commitment;
  }

  // Save metadata + proofs
  db.prepare(`
    INSERT INTO uploads (
      anonId,
      folder,
      filename,
      size,
      uploadedAt,
      blobId,
      commitment
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    anonId,
    folder,
    req.file.filename,
    req.file.size,
    uploadedAt,
    blobId,
    commitment
  );

  res.json({
    message: "Photo uploaded",
    anonId,
    folder,
    uploadedAt,
    storage: storageResult
  });
});

// timeline route
app.get("/timeline/:anonId", (req, res) => {
  const anonId = req.params.anonId;

  const rows = db.prepare(`
    SELECT
      folder,
      filename,
      size,
      uploadedAt,
      blobId,
      commitment
    FROM uploads
    WHERE anonId = ?
    ORDER BY uploadedAt ASC
  `).all(anonId);

const uploads = rows.map(row => {
  const isVerified = row.blobId && row.commitment;

  return {
    folder: row.folder,
    filename: row.filename,
    size: row.size,
    uploadedAt: row.uploadedAt,
    proof: {
      status: isVerified ? "verified" : "unverified",
      verifyUrl: isVerified
        ? `http://localhost:3000/verify/${row.blobId}`
        : null
    }
  };
});

  res.json({ anonId, uploads });
});

// verify route
app.get("/verify/:blobId", (req, res) => {
  const { blobId } = req.params;

  const row = db.prepare(`
    SELECT
      anonId,
      folder,
      filename,
      uploadedAt,
      blobId,
      commitment
    FROM uploads
    WHERE blobId = ?
  `).get(blobId);

  if (!row) {
    return res.status(404).json({
      status: "not_found",
      message: "No upload found for this blobId"
    });
  }

  if (!row.commitment) {
    return res.json({
      status: "unverified",
      message: "Upload exists but has no verification proof yet",
      upload: {
        anonId: row.anonId,
        folder: row.folder,
        filename: row.filename,
        uploadedAt: row.uploadedAt
      }
    });
  }

  res.json({
    status: "verified",
    proof: {
      blobId: row.blobId,
      commitment: row.commitment
    },
    upload: {
      anonId: row.anonId,
      folder: row.folder,
      filename: row.filename,
      uploadedAt: row.uploadedAt
    }
  });
});

// debug route (optional)
app.get("/debug/uploads", (req, res) => {
  const rows = db.prepare(`SELECT * FROM uploads`).all();
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
