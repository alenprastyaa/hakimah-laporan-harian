const express = require("express");
const {
  ocrKtp,
  createKtpUploadUrl,
  createKtpChunkUpload,
  appendKtpChunkUpload,
  completeKtpChunkUpload,
  createWithdrawal,
  getAllWithdrawals,
  getWithdrawalById,
  deleteWithdrawal,
} = require("../controllers/withdrawalController");
const { verifyToken, authorizeRole } = require("../middleware/auth");

const router = express.Router();

router.post("/ocr-ktp", verifyToken, authorizeRole(["admin", "karyawan"]), ocrKtp);
router.post("/ktp-upload-url", verifyToken, authorizeRole(["admin", "karyawan"]), createKtpUploadUrl);
router.post("/ktp-chunk-upload", verifyToken, authorizeRole(["admin", "karyawan"]), createKtpChunkUpload);
router.post(
  "/ktp-chunk-upload/:uploadId/chunks",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  appendKtpChunkUpload,
);
router.post(
  "/ktp-chunk-upload/:uploadId/complete",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  completeKtpChunkUpload,
);
router.post("/", verifyToken, authorizeRole(["admin", "karyawan"]), createWithdrawal);
router.get("/", verifyToken, authorizeRole(["admin", "karyawan"]), getAllWithdrawals);
router.get("/:id", verifyToken, authorizeRole(["admin", "karyawan"]), getWithdrawalById);
router.delete("/:id", verifyToken, authorizeRole(["admin"]), deleteWithdrawal);

module.exports = router;
