const PDFDocument = require("pdfkit");
const { format } = require("date-fns");
const { id } = require("date-fns/locale");

const formatCurrency = (value) => {
  const number = Number(value || 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(number);
};

const formatDateId = (dateValue) =>
  format(new Date(dateValue), "dd MMMM yyyy", { locale: id });

const toMysqlDate = (dateValue) => format(new Date(dateValue), "yyyy-MM-dd");

const normalizeProfitRows = (rows, reportDate) => {
  return rows.map((row, index) => {
    const todayBalance = Number(row.today_balance || 0);
    const previousBalance = Number(row.previous_balance || 0);
    const hasTodayReport = Boolean(row.today_report_id);
    const hasPreviousReport = Boolean(row.previous_report_date);
    const profit = hasTodayReport ? todayBalance - previousBalance : 0;

    return {
      no: index + 1,
      store_id: row.store_id,
      store_name: row.store_name,
      report_date: reportDate,
      previous_date: row.previous_report_date || null,
      today_balance: todayBalance,
      previous_balance: previousBalance,
      profit,
      has_today_report: hasTodayReport,
      has_previous_report: hasPreviousReport,
    };
  });
};

const buildDailyProfitMessage = ({ reportDate, rows, pdfUrl }) => {
  const completedRows = rows.filter((row) => row.has_today_report);
  const totalProfit = completedRows.reduce((sum, row) => sum + row.profit, 0);
  const totalStores = rows.length;
  const completedStores = completedRows.length;

  return [
    `Laporan Keuntungan Harian`,
    `Tanggal: ${formatDateId(reportDate)}`,
    `Toko laporan: ${completedStores}/${totalStores}`,
    `Total keuntungan: ${formatCurrency(totalProfit)}`,
    ``,
    `PDF: ${pdfUrl}`,
  ].join("\n");
};

const generateDailyProfitPdf = ({ reportDate, rows }) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 34 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const completedRows = rows.filter((row) => row.has_today_report);
    const totalProfit = completedRows.reduce((sum, row) => sum + row.profit, 0);
    const totalTodayBalance = completedRows.reduce((sum, row) => sum + row.today_balance, 0);
    const totalPreviousBalance = completedRows.reduce(
      (sum, row) => sum + row.previous_balance,
      0
    );
    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 68;

    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(24).text("Laporan Keuntungan Harian");
    doc.moveDown(0.15);
    doc.font("Helvetica").fontSize(13).fillColor("#475569").text(`Tanggal laporan: ${formatDateId(reportDate)}`);
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(11).fillColor("#64748b").text(
      "Ringkasan di bawah ini dibuat untuk dibaca cepat. Fokus utama ada pada keuntungan dan saldo per toko.",
      { width: contentWidth, lineGap: 4 }
    );

    doc.moveDown(1);
    doc.y += 6;

    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(16).text("Rincian per toko");
    doc.moveDown(0.5);

    const drawStoreBlock = (row) => {
      const titleText = `${row.no}. ${row.store_name}`
      const profitText = row.has_today_report ? formatCurrency(row.profit) : "Belum ada laporan hari ini"
      const todayText = `Saldo hari ini: ${row.has_today_report ? formatCurrency(row.today_balance) : "-"}`
      const previousText = `Saldo sebelumnya: ${
        row.has_previous_report ? formatCurrency(row.previous_balance) : "Rp 0"
      }${row.previous_date ? ` (${formatDateId(row.previous_date)})` : ""}`

      const blockHeight =
        24 +
        doc.heightOfString(titleText, {
          width: contentWidth - 32,
          font: "Helvetica-Bold",
          size: 15,
        }) +
        doc.heightOfString(profitText, {
          width: contentWidth - 32,
          font: "Helvetica-Bold",
          size: 18,
        }) +
        doc.heightOfString(todayText, {
          width: contentWidth - 32,
          font: "Helvetica-Bold",
          size: 13,
        }) +
        doc.heightOfString(previousText, {
          width: contentWidth - 32,
          font: "Helvetica-Bold",
          size: 13,
        }) +
        22;

      if (doc.y + blockHeight > 760) {
        doc.addPage();
        doc.y = 34;
      }

      const y = doc.y;
      doc.roundedRect(34, y, contentWidth, blockHeight, 12).fill("#ffffff");
      doc.roundedRect(34, y, contentWidth, blockHeight, 12).stroke("#e2e8f0");

      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(15).text(titleText, 48, y + 14, {
        width: contentWidth - 32,
        lineGap: 2,
      });

      doc.fillColor(row.profit < 0 ? "#dc2626" : "#059669").font("Helvetica-Bold").fontSize(18).text(
        profitText,
        48,
        y + 41,
        { width: contentWidth - 32, lineGap: 2 }
      );

      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(13).text(
        todayText,
        48,
        y + blockHeight - 42,
        { width: contentWidth - 32, lineGap: 2 }
      );

      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(13).text(
        previousText,
        48,
        y + blockHeight - 20,
        { width: contentWidth - 32, lineGap: 2 }
      );

      doc.y = y + blockHeight + 10;
    };

    rows.forEach((row) => drawStoreBlock(row));

    if (doc.y > 735) {
      doc.addPage();
      doc.y = 34;
    }

    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#64748b")
      .text(
        "Catatan: saldo sebelumnya diambil dari laporan terakhir sebelum tanggal laporan. Jika memang belum ada data sebelumnya, maka nilai sebelumnya ditampilkan sebagai nol/tidak ada data.",
        34,
        doc.y + 8,
        { width: contentWidth, lineGap: 4 }
      );

    doc.end();
  });
};

module.exports = {
  buildDailyProfitMessage,
  formatCurrency,
  generateDailyProfitPdf,
  normalizeProfitRows,
  toMysqlDate,
};
