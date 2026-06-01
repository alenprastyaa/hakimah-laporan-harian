const { pool } = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const {
  uploadBufferToR2,
  deleteObjectFromR2,
  decodeBase64File,
  sanitizeFileName,
} = require("../utils/r2");
const { recognizeKtp } = require("../utils/ktpOcr");

const MAX_WITHDRAWAL_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

const parseAmount = (value) => {
  const normalized = String(value ?? "")
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");

  return Number(normalized);
};

const cleanText = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

const validateAndDecodeKtpFile = ({ ktp_file_data }) => {
  if (!ktp_file_data) {
    const error = new Error("Foto KTP harus diunggah.");
    error.statusCode = 400;
    throw error;
  }

  let decodedFile;
  try {
    decodedFile = decodeBase64File(ktp_file_data);
  } catch (decodeError) {
    decodeError.statusCode = 400;
    throw decodeError;
  }

  if (!ALLOWED_MIME_TYPES.includes(decodedFile.mimeType)) {
    const error = new Error("Format foto KTP harus JPG, JPEG, PNG, atau WEBP.");
    error.statusCode = 400;
    throw error;
  }

  if (decodedFile.buffer.length > MAX_WITHDRAWAL_FILE_SIZE) {
    const error = new Error("Ukuran foto KTP maksimal 5 MB.");
    error.statusCode = 400;
    throw error;
  }

  return decodedFile;
};

const scanKtp = async (buffer) => {
  try {
    const ocrResult = await recognizeKtp(buffer);
    return {
      ktp_ocr_status: "completed",
      ktp_ocr_text: ocrResult.rawText,
      ktp_ocr_error: null,
      ktp_nik: ocrResult.parsed?.nik || null,
      ktp_name: ocrResult.parsed?.name || null,
      ktp_birth_place: ocrResult.parsed?.birth_place || null,
      ktp_birth_date: ocrResult.parsed?.birth_date || null,
      ktp_gender: ocrResult.parsed?.gender || null,
      ktp_address: ocrResult.parsed?.address || null,
    };
  } catch (ocrError) {
    console.error("KTP OCR failed:", ocrError);
    return {
      ktp_ocr_status: "failed",
      ktp_ocr_text: null,
      ktp_ocr_error: ocrError.message,
      ktp_nik: null,
      ktp_name: null,
      ktp_birth_place: null,
      ktp_birth_date: null,
      ktp_gender: null,
      ktp_address: null,
    };
  }
};

const buildKtpFields = (body, ocrFields) => ({
  ktp_ocr_status: cleanText(body.ktp_ocr_status) || ocrFields.ktp_ocr_status,
  ktp_ocr_text: cleanText(body.ktp_ocr_text) || ocrFields.ktp_ocr_text,
  ktp_ocr_error: cleanText(body.ktp_ocr_error) || ocrFields.ktp_ocr_error,
  ktp_nik: cleanText(body.ktp_nik) || ocrFields.ktp_nik,
  ktp_name: cleanText(body.ktp_name) || cleanText(body.withdrawal_name) || ocrFields.ktp_name,
  ktp_birth_place: cleanText(body.ktp_birth_place) || ocrFields.ktp_birth_place,
  ktp_birth_date: cleanText(body.ktp_birth_date) || ocrFields.ktp_birth_date,
  ktp_gender: cleanText(body.ktp_gender) || ocrFields.ktp_gender,
  ktp_address: cleanText(body.ktp_address) || ocrFields.ktp_address,
});

const ocrKtp = async (req, res) => {
  try {
    const decodedFile = validateAndDecodeKtpFile(req.body);
    const ocrFields = await scanKtp(decodedFile.buffer);

    return res.status(200).json({
      message:
        ocrFields.ktp_ocr_status === "completed"
          ? "OCR KTP berhasil diproses."
          : "OCR KTP gagal diproses, isi data secara manual.",
      ...ocrFields,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.message || "Gagal memproses OCR KTP.",
    });
  }
};

const createWithdrawal = async (req, res) => {
  const { withdrawal_name, amount, ktp_file_name, ktp_file_data } = req.body;
  const createdBy = req.user?.user_id;

  if (!withdrawal_name || !String(withdrawal_name).trim()) {
    return res.status(400).json({ message: "Nama penarik harus diisi." });
  }

  const withdrawalAmount = parseAmount(amount);
  if (!Number.isFinite(withdrawalAmount) || withdrawalAmount <= 0) {
    return res.status(400).json({ message: "Jumlah penarikan harus lebih dari 0." });
  }

  if (!ktp_file_name || !ktp_file_data) {
    return res.status(400).json({ message: "Foto KTP harus diunggah." });
  }

  let decodedFile;
  try {
    decodedFile = validateAndDecodeKtpFile(req.body);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  const withdrawalId = uuidv4();
  const safeFileName = sanitizeFileName(ktp_file_name);
  const createdAt = new Date();
  const datePrefix = createdAt.toISOString().slice(0, 10).replace(/-/g, "/");
  const r2Key = `withdrawals/${datePrefix}/${withdrawalId}-${safeFileName}`;

  try {
    const hasOcrPayload =
      req.body.ktp_ocr_status ||
      req.body.ktp_ocr_text ||
      req.body.ktp_nik ||
      req.body.ktp_name ||
      req.body.ktp_birth_place ||
      req.body.ktp_birth_date ||
      req.body.ktp_gender ||
      req.body.ktp_address;
    const ocrFields = hasOcrPayload ? {} : await scanKtp(decodedFile.buffer);
    const ktpFields = buildKtpFields(req.body, ocrFields);

    const uploaded = await uploadBufferToR2({
      key: r2Key,
      buffer: decodedFile.buffer,
      contentType: decodedFile.mimeType,
    });

    await pool.query(
      `
      INSERT INTO withdrawals (
        withdrawal_id,
        withdrawal_name,
        amount,
        ktp_file_name,
        ktp_file_key,
        ktp_file_url,
        ktp_ocr_status,
        ktp_ocr_text,
        ktp_ocr_error,
        ktp_nik,
        ktp_name,
        ktp_birth_place,
        ktp_birth_date,
        ktp_gender,
        ktp_address,
        created_by,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        withdrawalId,
        String(withdrawal_name).trim(),
        withdrawalAmount,
        ktp_file_name,
        uploaded.key,
        uploaded.url,
        ktpFields.ktp_ocr_status || "pending",
        ktpFields.ktp_ocr_text,
        ktpFields.ktp_ocr_error?.slice(0, 500) || null,
        ktpFields.ktp_nik,
        ktpFields.ktp_name,
        ktpFields.ktp_birth_place,
        ktpFields.ktp_birth_date,
        ktpFields.ktp_gender,
        ktpFields.ktp_address,
        createdBy,
        createdAt,
      ],
    );

    return res.status(201).json({
      message: "Tarik uang berhasil dibuat.",
      withdrawal: {
        withdrawal_id: withdrawalId,
        withdrawal_name: String(withdrawal_name).trim(),
        amount: withdrawalAmount,
        ktp_file_name,
        ktp_file_key: uploaded.key,
        ktp_file_url: uploaded.url,
        ktp_ocr_status: ktpFields.ktp_ocr_status || "pending",
        ktp_ocr_text: ktpFields.ktp_ocr_text,
        ktp_ocr_error: ktpFields.ktp_ocr_error,
        ktp_nik: ktpFields.ktp_nik,
        ktp_name: ktpFields.ktp_name,
        ktp_birth_place: ktpFields.ktp_birth_place,
        ktp_birth_date: ktpFields.ktp_birth_date,
        ktp_gender: ktpFields.ktp_gender,
        ktp_address: ktpFields.ktp_address,
        created_at: createdAt,
        created_by: createdBy,
      },
    });
  } catch (error) {
    console.error("Error creating withdrawal:", error);
    try {
      await deleteObjectFromR2(r2Key);
    } catch (cleanupError) {
      console.error("Error cleaning up uploaded withdrawal file:", cleanupError);
    }

    return res.status(500).json({
      message: "Gagal membuat data tarik uang.",
      error: error.message,
    });
  }
};

const getAllWithdrawals = async (req, res) => {
  const { user_id, role } = req.user;
  const search = String(req.query.search || "").trim();
  const searchDigits = search.replace(/\D/g, "");

  try {
    const whereClauses = [];
    const params = [];

    if (role !== "admin") {
      whereClauses.push("w.created_by = ?");
      params.push(user_id);
    }

    if (search) {
      const searchLike = `%${search}%`;
      const searchConditions = [
        "w.withdrawal_name LIKE ?",
        "w.ktp_name LIKE ?",
        "w.ktp_nik LIKE ?",
        "CAST(w.amount AS CHAR) LIKE ?",
      ];
      params.push(searchLike, searchLike, searchLike, searchLike);

      if (searchDigits) {
        searchConditions.push("REPLACE(CAST(w.amount AS CHAR), '.', '') LIKE ?");
        params.push(`%${searchDigits}%`);
      }

      whereClauses.push(`(${searchConditions.join(" OR ")})`);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const [withdrawals] = await pool.query(
      `
      SELECT
        w.withdrawal_id,
        w.withdrawal_name,
        w.amount,
        w.ktp_file_name,
        w.ktp_file_key,
        w.ktp_file_url,
        w.ktp_ocr_status,
        w.ktp_ocr_text,
        w.ktp_ocr_error,
        w.ktp_nik,
        w.ktp_name,
        w.ktp_birth_place,
        w.ktp_birth_date,
        w.ktp_gender,
        w.ktp_address,
        w.created_by,
        w.created_at,
        u.username AS created_by_username,
        u.role AS created_by_role
      FROM withdrawals w
      LEFT JOIN users u ON u.user_id = w.created_by
      ${whereSql}
      ORDER BY w.created_at DESC
      `,
      params,
    );

    res.status(200).json({ withdrawals, search });
  } catch (error) {
    console.error("Error fetching withdrawals:", error);
    res.status(500).json({
      message: "Gagal mendapatkan data tarik uang.",
      error: error.message,
    });
  }
};

const getWithdrawalById = async (req, res) => {
  const { id } = req.params;
  const { user_id, role } = req.user;

  try {
    const [withdrawals] = await pool.query(
      `
      SELECT
        w.withdrawal_id,
        w.withdrawal_name,
        w.amount,
        w.ktp_file_name,
        w.ktp_file_key,
        w.ktp_file_url,
        w.ktp_ocr_status,
        w.ktp_ocr_text,
        w.ktp_ocr_error,
        w.ktp_nik,
        w.ktp_name,
        w.ktp_birth_place,
        w.ktp_birth_date,
        w.ktp_gender,
        w.ktp_address,
        w.created_by,
        w.created_at,
        u.username AS created_by_username,
        u.role AS created_by_role
      FROM withdrawals w
      LEFT JOIN users u ON u.user_id = w.created_by
      WHERE w.withdrawal_id = ?
      LIMIT 1
      `,
      [id],
    );

    if (withdrawals.length === 0) {
      return res.status(404).json({ message: "Data tarik uang tidak ditemukan." });
    }

    const withdrawal = withdrawals[0];
    if (role !== "admin" && withdrawal.created_by !== user_id) {
      return res.status(403).json({ message: "Akses ditolak." });
    }

    res.status(200).json(withdrawal);
  } catch (error) {
    console.error("Error fetching withdrawal by ID:", error);
    res.status(500).json({
      message: "Gagal mendapatkan detail tarik uang.",
      error: error.message,
    });
  }
};

const deleteWithdrawal = async (req, res) => {
  const { id } = req.params;
  const { user_id, role } = req.user;

  try {
    const [withdrawals] = await pool.query(
      "SELECT withdrawal_id, ktp_file_key, created_by FROM withdrawals WHERE withdrawal_id = ? LIMIT 1",
      [id],
    );

    if (withdrawals.length === 0) {
      return res.status(404).json({ message: "Data tarik uang tidak ditemukan." });
    }

    const withdrawal = withdrawals[0];
    if (role !== "admin" && withdrawal.created_by !== user_id) {
      return res.status(403).json({ message: "Akses ditolak." });
    }

    await pool.query("DELETE FROM withdrawals WHERE withdrawal_id = ?", [id]);
    await deleteObjectFromR2(withdrawal.ktp_file_key);

    res.status(200).json({ message: "Data tarik uang berhasil dihapus." });
  } catch (error) {
    console.error("Error deleting withdrawal:", error);
    res.status(500).json({
      message: "Gagal menghapus data tarik uang.",
      error: error.message,
    });
  }
};

module.exports = {
  ocrKtp,
  createWithdrawal,
  getAllWithdrawals,
  getWithdrawalById,
  deleteWithdrawal,
};
