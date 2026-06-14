const express = require("express");
const {
  createDeposit,
  createRecipient,
  deleteDeposit,
  deleteRecipient,
  getDeposits,
  getDepositSummary,
  getRecipients,
  updateRecipient,
} = require("../controllers/depositController");
const { verifyToken, authorizeRole } = require("../middleware/auth");

const router = express.Router();

router.get("/recipients", verifyToken, authorizeRole(["admin", "karyawan"]), getRecipients);
router.post("/recipients", verifyToken, authorizeRole(["admin"]), createRecipient);
router.put("/recipients/:id", verifyToken, authorizeRole(["admin"]), updateRecipient);
router.delete("/recipients/:id", verifyToken, authorizeRole(["admin"]), deleteRecipient);

router.get("/", verifyToken, authorizeRole(["admin", "karyawan"]), getDeposits);
router.get("/summary", verifyToken, authorizeRole(["admin", "karyawan"]), getDepositSummary);
router.post("/", verifyToken, authorizeRole(["admin", "karyawan"]), createDeposit);
router.delete("/:id", verifyToken, authorizeRole(["admin"]), deleteDeposit);

module.exports = router;
