// src/routes/reportRoutes.js
const express = require("express");
const {
  createReport,
  getAllReports,
  getReportById,
  updateReport,
  deleteReport,
  getProfitAnalysis,
  removeUangNitip,
} = require("../controllers/reportController");
const {
  verifyToken,
  authorizeRole,
  authorizeStoreAccess,
} = require("../middleware/auth");

const router = express.Router();
router.patch(
  "/:id/remove-uang-nitip",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  removeUangNitip
);

router.get(
  "/analysis/profit",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  getProfitAnalysis
);

router.post(
  "/",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  authorizeStoreAccess,
  createReport
);

router.get(
  "/",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  getAllReports
);

router.get(
  "/:id",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  getReportById
);

router.put(
  "/:id",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  authorizeStoreAccess,
  updateReport
);

router.delete(
  "/:id",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  deleteReport
);

module.exports = router;
