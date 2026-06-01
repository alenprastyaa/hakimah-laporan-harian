const cron = require("node-cron");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");
const { sendDailyProfitReportToRecipients } = require("./whatsappReportService");

const TIMEZONE = process.env.WHATSAPP_SCHEDULE_TIMEZONE || "Asia/Jakarta";

const getZonedDateTimeParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
};

const claimScheduleRun = async ({ scheduleId, reportDate, scheduledTime }) => {
  const runId = uuidv4();

  try {
    await pool.query(
      `
      INSERT INTO whatsapp_report_schedule_runs
        (run_id, schedule_id, report_date, scheduled_time, status)
      VALUES (?, ?, ?, ?, ?)
      `,
      [runId, scheduleId, reportDate, `${scheduledTime}:00`, "running"]
    );

    return runId;
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return null;
    throw error;
  }
};

const updateScheduleRun = async ({ runId, status, sent = 0, failed = 0, pdfUrl = null, error = null }) => {
  await pool.query(
    `
    UPDATE whatsapp_report_schedule_runs
    SET status = ?,
        sent_count = ?,
        failed_count = ?,
        pdf_file_url = ?,
        error_message = ?,
        finished_at = CURRENT_TIMESTAMP
    WHERE run_id = ?
    `,
    [status, sent, failed, pdfUrl, error, runId]
  );
};

const runDueWhatsappReportSchedules = async () => {
  const { date, time } = getZonedDateTimeParts();

  const [schedules] = await pool.query(
    `
    SELECT schedule_id, TIME_FORMAT(scheduled_time, '%H:%i') AS scheduled_time
    FROM whatsapp_report_schedules
    WHERE is_active = 1
      AND TIME_FORMAT(scheduled_time, '%H:%i') = ?
    `,
    [time]
  );

  for (const schedule of schedules) {
    const runId = await claimScheduleRun({
      scheduleId: schedule.schedule_id,
      reportDate: date,
      scheduledTime: schedule.scheduled_time,
    });

    if (!runId) continue;

    try {
      const result = await sendDailyProfitReportToRecipients({
        date,
        recipientIds: [],
        sentBy: null,
      });

      await updateScheduleRun({
        runId,
        status: result.sent > 0 ? "sent" : "failed",
        sent: result.sent,
        failed: result.failed,
        pdfUrl: result.pdf_url,
      });

      console.log(
        `[whatsapp-scheduler] ${date} ${time} sent=${result.sent} failed=${result.failed}`
      );
    } catch (error) {
      await updateScheduleRun({
        runId,
        status: "failed",
        error: error.message,
      });

      console.error(`[whatsapp-scheduler] ${date} ${time} failed:`, error.message);
    }
  }
};

const startWhatsappReportScheduler = () => {
  const enabled = process.env.WHATSAPP_SCHEDULER_ENABLED !== "false";
  if (!enabled) {
    console.log("[whatsapp-scheduler] disabled");
    return null;
  }

  const task = cron.schedule(
    "* * * * *",
    () => {
      runDueWhatsappReportSchedules().catch((error) => {
        console.error("[whatsapp-scheduler] job error:", error.message);
      });
    },
    { timezone: TIMEZONE }
  );

  console.log(`[whatsapp-scheduler] running, timezone=${TIMEZONE}`);
  return task;
};

module.exports = {
  runDueWhatsappReportSchedules,
  startWhatsappReportScheduler,
};
