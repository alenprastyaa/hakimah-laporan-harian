const express = require("express");
const {
  createRecipient,
  createSchedule,
  deleteRecipient,
  deleteSchedule,
  generateDailyProfitPdfOnly,
  getRecipients,
  getSchedules,
  sendDailyProfitReport,
  updateSchedule,
  updateRecipient,
} = require("../controllers/whatsappReportController");
const { verifyToken, authorizeRole } = require("../middleware/auth");

const router = express.Router();

router.use(verifyToken, authorizeRole(["admin"]));

router.get("/recipients", getRecipients);
router.post("/recipients", createRecipient);
router.put("/recipients/:id", updateRecipient);
router.delete("/recipients/:id", deleteRecipient);
router.get("/schedules", getSchedules);
router.post("/schedules", createSchedule);
router.put("/schedules/:id", updateSchedule);
router.delete("/schedules/:id", deleteSchedule);
router.post("/daily-profit/pdf", generateDailyProfitPdfOnly);
router.post("/daily-profit/send", sendDailyProfitReport);

module.exports = router;
