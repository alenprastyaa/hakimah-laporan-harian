const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");
const { uploadBufferToR2 } = require("../utils/r2");
const {
  buildDailyProfitMessage,
  generateDailyProfitPdf,
  normalizeProfitRows,
  toMysqlDate,
} = require("../utils/dailyProfitReport");
const { normalizePhoneNumber, sendWhatsAppDocument } = require("../utils/whatsapp");

const getDailyProfitRows = async ({ date, storeId = "" }) => {
  const reportDate = toMysqlDate(date);
  const params = [reportDate, reportDate];

  let storeFilter = "";
  if (storeId) {
    storeFilter = "WHERE s.store_id = ?";
    params.push(storeId);
  }

  const [rows] = await pool.query(
    `
    SELECT
      s.store_id,
      s.store_name,
      today.report_id AS today_report_id,
      today.total_balance AS today_balance,
      previous.report_date AS previous_report_date,
      previous.total_balance AS previous_balance
    FROM stores s
    LEFT JOIN reports today
      ON today.store_id = s.store_id
      AND today.report_date = ?
    LEFT JOIN reports previous
      ON previous.store_id = s.store_id
      AND previous.report_date = (
        SELECT MAX(rp.report_date)
        FROM reports rp
        WHERE rp.store_id = s.store_id
          AND rp.report_date < ?
      )
    ${storeFilter}
    ORDER BY s.store_name ASC
    `,
    params
  );

  return {
    reportDate,
    previousDate: null,
    rows: normalizeProfitRows(rows, reportDate),
  };
};

const getReportRecipients = async (recipientIds = []) => {
  const recipientParams = [];
  let recipientFilter = "WHERE is_active = 1";

  if (Array.isArray(recipientIds) && recipientIds.length > 0) {
    recipientFilter = "WHERE recipient_id IN (?) AND is_active = 1";
    recipientParams.push(recipientIds);
  }

  const [recipients] = await pool.query(
    `
    SELECT recipient_id, name, phone_number, is_active
    FROM whatsapp_recipients
    ${recipientFilter}
    ORDER BY name ASC
    `,
    recipientParams
  );

  return recipients;
};

const generateDailyProfitPdfFile = async ({ date, storeId = "" }) => {
  const dailyProfit = await getDailyProfitRows({ date, storeId });
  const pdfBuffer = await generateDailyProfitPdf(dailyProfit);
  const fileName = `laporan-keuntungan-harian-${dailyProfit.reportDate}.pdf`;
  const datePath = dailyProfit.reportDate.replace(/-/g, "/");
  const fileKey = `daily-profit-reports/${datePath}/${uuidv4()}-${fileName}`;
  const uploaded = await uploadBufferToR2({
    key: fileKey,
    buffer: pdfBuffer,
    contentType: "application/pdf",
  });

  return {
    report_date: dailyProfit.reportDate,
    previous_date: dailyProfit.previousDate,
    file_name: fileName,
    pdf_key: uploaded.key,
    pdf_url: uploaded.url,
    rows: dailyProfit.rows,
  };
};

const sendDailyProfitReportToRecipients = async ({
  date,
  recipientIds = [],
  storeId = "",
  sentBy = null,
}) => {
  const recipients = await getReportRecipients(recipientIds);

  if (recipients.length === 0) {
    const error = new Error("Tidak ada nomor WhatsApp aktif untuk dikirim.");
    error.statusCode = 400;
    throw error;
  }

  const generatedPdf = await generateDailyProfitPdfFile({ date, storeId });

  const message = buildDailyProfitMessage({
    reportDate: generatedPdf.report_date,
    rows: generatedPdf.rows,
    pdfUrl: generatedPdf.pdf_url,
  });

  const results = [];

  for (const recipient of recipients) {
    const sendId = uuidv4();
    try {
      const sendResult = await sendWhatsAppDocument({
        phoneNumber: recipient.phone_number,
        message,
        fileUrl: generatedPdf.pdf_url,
        fileName: generatedPdf.file_name,
      });

      await pool.query(
        `
        INSERT INTO whatsapp_report_sends
          (send_id, report_date, pdf_file_key, pdf_file_url, recipient_id, phone_number, status, provider_response, sent_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          sendId,
          generatedPdf.report_date,
          generatedPdf.pdf_key,
          generatedPdf.pdf_url,
          recipient.recipient_id,
          sendResult.target,
          "sent",
          JSON.stringify(sendResult.response),
          sentBy,
        ]
      );

      results.push({
        recipient_id: recipient.recipient_id,
        name: recipient.name,
        phone_number: sendResult.target,
        status: "sent",
      });
    } catch (error) {
      await pool.query(
        `
        INSERT INTO whatsapp_report_sends
          (send_id, report_date, pdf_file_key, pdf_file_url, recipient_id, phone_number, status, error_message, sent_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          sendId,
          generatedPdf.report_date,
          generatedPdf.pdf_key,
          generatedPdf.pdf_url,
          recipient.recipient_id,
          normalizePhoneNumber(recipient.phone_number),
          "failed",
          error.message,
          sentBy,
        ]
      );

      results.push({
        recipient_id: recipient.recipient_id,
        name: recipient.name,
        phone_number: normalizePhoneNumber(recipient.phone_number),
        status: "failed",
        error: error.message,
      });
    }
  }

  const sentCount = results.filter((result) => result.status === "sent").length;

  return {
    report_date: generatedPdf.report_date,
    pdf_key: generatedPdf.pdf_key,
    pdf_url: generatedPdf.pdf_url,
    file_name: generatedPdf.file_name,
    sent: sentCount,
    failed: results.length - sentCount,
    results,
  };
};

module.exports = {
  generateDailyProfitPdfFile,
  getDailyProfitRows,
  sendDailyProfitReportToRecipients,
};
