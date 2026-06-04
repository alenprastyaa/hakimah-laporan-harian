const { pool } = require("../config/db");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const {
  uploadBufferToR2,
  deleteObjectFromR2,
  decodeBase64File,
  createPresignedPutUrl,
  sanitizeFileName,
} = require("../utils/r2");
const { recognizeKtp } = require("../utils/ktpOcr");

const MAX_WITHDRAWAL_FILE_SIZE = 5 * 1024 * 1024;
const MAX_WITHDRAWAL_CHUNK_SIZE = 768 * 1024;
const WITHDRAWAL_UPLOAD_CHUNK_SIZE = 512 * 1024;
const WITHDRAWAL_UPLOAD_DIR = path.join(os.tmpdir(), "brilink-withdrawal-uploads");
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

const isAllowedMimeType = (mimeType) => ALLOWED_MIME_TYPES.includes(String(mimeType || ""));

const buildWithdrawalFileKey = (fileName) => {
  const withdrawalId = uuidv4();
  const safeFileName = sanitizeFileName(fileName);
  const createdAt = new Date();
  const datePrefix = createdAt.toISOString().slice(0, 10).replace(/-/g, "/");
  return `withdrawals/${datePrefix}/${withdrawalId}-${safeFileName}`;
};

const getPublicR2Url = (key) =>
  `${String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "")}/${key}`;

const isValidWithdrawalR2File = ({ key, url }) => {
  const normalizedKey = cleanText(key);
  const normalizedUrl = cleanText(url);
  if (!normalizedKey || !normalizedUrl) return false;
  if (!normalizedKey.startsWith("withdrawals/")) return false;
  return normalizedUrl === getPublicR2Url(normalizedKey);
};

const getChunkUploadDir = (uploadId) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(uploadId || ""))) {
    const error = new Error("Upload ID tidak valid.");
    error.statusCode = 400;
    throw error;
  }

  return path.join(WITHDRAWAL_UPLOAD_DIR, uploadId);
};

const getChunkUploadPaths = (uploadId) => {
  const uploadDir = getChunkUploadDir(uploadId);
  return {
    uploadDir,
    metaPath: path.join(uploadDir, "meta.json"),
    dataPath: path.join(uploadDir, "ktp.bin"),
  };
};

const readChunkUploadMeta = async (uploadId) => {
  const { metaPath } = getChunkUploadPaths(uploadId);
  const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
  return meta;
};

const cleanupChunkUpload = async (uploadId) => {
  const { uploadDir } = getChunkUploadPaths(uploadId);
  await fs.rm(uploadDir, { recursive: true, force: true });
};

const decodeChunkData = (chunkData) => {
  if (typeof chunkData !== "string" || !chunkData.trim()) {
    const error = new Error("Data chunk KTP tidak valid.");
    error.statusCode = 400;
    throw error;
  }

  const base64Content = chunkData.includes(",") ? chunkData.split(",").pop() : chunkData;
  return Buffer.from(base64Content, "base64");
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

  if (!isAllowedMimeType(decodedFile.mimeType)) {
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

const fetchKtpBufferFromUrl = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Gagal mengambil foto KTP dari R2 (${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
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

const updateWithdrawalOcr = async (withdrawalId, buffer, body) => {
  try {
    const ocrFields = await scanKtp(buffer);
    const ktpFields = buildKtpFields(body, ocrFields);

    await pool.query(
      `
      UPDATE withdrawals
      SET
        ktp_ocr_status = ?,
        ktp_ocr_text = ?,
        ktp_ocr_error = ?,
        ktp_nik = ?,
        ktp_name = ?,
        ktp_birth_place = ?,
        ktp_birth_date = ?,
        ktp_gender = ?,
        ktp_address = ?
      WHERE withdrawal_id = ?
      `,
      [
        ktpFields.ktp_ocr_status || "failed",
        ktpFields.ktp_ocr_text,
        ktpFields.ktp_ocr_error?.slice(0, 500) || null,
        ktpFields.ktp_nik,
        ktpFields.ktp_name,
        ktpFields.ktp_birth_place,
        ktpFields.ktp_birth_date,
        ktpFields.ktp_gender,
        ktpFields.ktp_address,
        withdrawalId,
      ],
    );
  } catch (error) {
    console.error("Error updating withdrawal OCR:", error);
    await pool.query(
      `
      UPDATE withdrawals
      SET ktp_ocr_status = ?, ktp_ocr_error = ?
      WHERE withdrawal_id = ?
      `,
      ["failed", (error.message || "Gagal memproses OCR KTP.").slice(0, 500), withdrawalId],
    );
  }
};

const updateWithdrawalOcrFromUrl = async (withdrawalId, fileUrl, body) => {
  try {
    const buffer = await fetchKtpBufferFromUrl(fileUrl);
    await updateWithdrawalOcr(withdrawalId, buffer, body);
  } catch (error) {
    console.error("Error reading withdrawal KTP for OCR:", error);
    await pool.query(
      `
      UPDATE withdrawals
      SET ktp_ocr_status = ?, ktp_ocr_error = ?
      WHERE withdrawal_id = ?
      `,
      ["failed", (error.message || "Gagal membaca foto KTP dari R2.").slice(0, 500), withdrawalId],
    );
  }
};

const createKtpUploadUrl = async (req, res) => {
  try {
    const fileName = cleanText(req.body.ktp_file_name);
    const mimeType = cleanText(req.body.ktp_mime_type);
    const fileSize = Number(req.body.ktp_file_size || 0);

    if (!fileName) {
      return res.status(400).json({ message: "Nama file KTP harus diisi." });
    }

    if (!isAllowedMimeType(mimeType)) {
      return res.status(400).json({ message: "Format foto KTP harus JPG, JPEG, PNG, atau WEBP." });
    }

    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_WITHDRAWAL_FILE_SIZE) {
      return res.status(400).json({ message: "Ukuran foto KTP maksimal 5 MB." });
    }

    const key = buildWithdrawalFileKey(fileName);
    const signedUpload = createPresignedPutUrl({ key });

    return res.status(200).json({
      upload_url: signedUpload.uploadUrl,
      ktp_file_key: signedUpload.key,
      ktp_file_url: signedUpload.url,
      expires_in: signedUpload.expiresIn,
    });
  } catch (error) {
    console.error("Error creating KTP upload URL:", error);
    return res.status(500).json({
      message: "Gagal membuat URL upload KTP.",
      error: error.message,
    });
  }
};

const createKtpChunkUpload = async (req, res) => {
  try {
    const fileName = cleanText(req.body.ktp_file_name);
    const mimeType = cleanText(req.body.ktp_mime_type);
    const fileSize = Number(req.body.ktp_file_size || 0);

    if (!fileName) {
      return res.status(400).json({ message: "Nama file KTP harus diisi." });
    }

    if (!isAllowedMimeType(mimeType)) {
      return res.status(400).json({ message: "Format foto KTP harus JPG, JPEG, PNG, atau WEBP." });
    }

    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_WITHDRAWAL_FILE_SIZE) {
      return res.status(400).json({ message: "Ukuran foto KTP maksimal 5 MB." });
    }

    const uploadId = uuidv4();
    const key = buildWithdrawalFileKey(fileName);
    const { uploadDir, metaPath, dataPath } = getChunkUploadPaths(uploadId);
    const meta = {
      upload_id: uploadId,
      ktp_file_name: fileName,
      ktp_mime_type: mimeType,
      ktp_file_size: fileSize,
      ktp_file_key: key,
      ktp_file_url: getPublicR2Url(key),
      received_bytes: 0,
      created_at: new Date().toISOString(),
    };

    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(metaPath, JSON.stringify(meta), "utf8");
    await fs.writeFile(dataPath, Buffer.alloc(0));

    return res.status(200).json({
      upload_id: uploadId,
      ktp_file_key: meta.ktp_file_key,
      ktp_file_url: meta.ktp_file_url,
      chunk_size: WITHDRAWAL_UPLOAD_CHUNK_SIZE,
    });
  } catch (error) {
    console.error("Error creating KTP chunk upload:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Gagal memulai upload KTP.",
    });
  }
};

const appendKtpChunkUpload = async (req, res) => {
  const { uploadId } = req.params;

  try {
    const meta = await readChunkUploadMeta(uploadId);
    const { metaPath, dataPath } = getChunkUploadPaths(uploadId);
    const chunkBuffer = decodeChunkData(req.body.chunk_data);

    if (chunkBuffer.length === 0 || chunkBuffer.length > MAX_WITHDRAWAL_CHUNK_SIZE) {
      return res.status(400).json({ message: "Ukuran chunk KTP tidak valid." });
    }

    const nextReceivedBytes = Number(meta.received_bytes || 0) + chunkBuffer.length;
    if (nextReceivedBytes > Number(meta.ktp_file_size)) {
      return res.status(400).json({ message: "Ukuran upload KTP melebihi file asli." });
    }

    await fs.appendFile(dataPath, chunkBuffer);
    meta.received_bytes = nextReceivedBytes;
    await fs.writeFile(metaPath, JSON.stringify(meta), "utf8");

    return res.status(200).json({
      upload_id: uploadId,
      received_bytes: meta.received_bytes,
      ktp_file_size: meta.ktp_file_size,
    });
  } catch (error) {
    console.error("Error appending KTP chunk upload:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Gagal mengunggah chunk KTP.",
    });
  }
};

const completeKtpChunkUpload = async (req, res) => {
  const { uploadId } = req.params;

  try {
    const meta = await readChunkUploadMeta(uploadId);
    const { dataPath } = getChunkUploadPaths(uploadId);
    const fileStat = await fs.stat(dataPath);

    if (fileStat.size !== Number(meta.ktp_file_size)) {
      return res.status(400).json({ message: "Upload KTP belum lengkap." });
    }

    const buffer = await fs.readFile(dataPath);
    const uploaded = await uploadBufferToR2({
      key: meta.ktp_file_key,
      buffer,
      contentType: meta.ktp_mime_type,
    });

    await cleanupChunkUpload(uploadId);

    return res.status(200).json({
      ktp_file_key: uploaded.key,
      ktp_file_url: uploaded.url,
    });
  } catch (error) {
    console.error("Error completing KTP chunk upload:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Gagal menyelesaikan upload KTP.",
    });
  }
};

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
  const { withdrawal_name, amount, ktp_file_name, ktp_file_data, ktp_file_key, ktp_file_url } =
    req.body;
  const createdBy = req.user?.user_id;

  if (!withdrawal_name || !String(withdrawal_name).trim()) {
    return res.status(400).json({ message: "Nama penarik harus diisi." });
  }

  const withdrawalAmount = parseAmount(amount);
  if (!Number.isFinite(withdrawalAmount) || withdrawalAmount <= 0) {
    return res.status(400).json({ message: "Jumlah penarikan harus lebih dari 0." });
  }

  if (!ktp_file_name || (!ktp_file_data && (!ktp_file_key || !ktp_file_url))) {
    return res.status(400).json({ message: "Foto KTP harus diunggah." });
  }

  let decodedFile = null;
  if (ktp_file_data) {
    try {
      decodedFile = validateAndDecodeKtpFile(req.body);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
  } else if (!isValidWithdrawalR2File({ key: ktp_file_key, url: ktp_file_url })) {
    return res.status(400).json({ message: "File KTP R2 tidak valid." });
  }

  const withdrawalId = uuidv4();
  const createdAt = new Date();
  let uploadedKeyForCleanup = null;

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
    const ocrFields = hasOcrPayload
      ? {}
      : {
          ktp_ocr_status: "pending",
          ktp_name: String(withdrawal_name).trim(),
        };
    const ktpFields = buildKtpFields(req.body, ocrFields);

    const uploaded = decodedFile
      ? await uploadBufferToR2({
          key: buildWithdrawalFileKey(ktp_file_name),
          buffer: decodedFile.buffer,
          contentType: decodedFile.mimeType,
        })
      : {
          key: ktp_file_key,
          url: ktp_file_url,
        };
    uploadedKeyForCleanup = uploaded.key;

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

    const responsePayload = {
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
    };

    if (!hasOcrPayload) {
      setImmediate(() => {
        const ocrBody = {
          ...req.body,
          withdrawal_name: String(withdrawal_name).trim(),
        };
        const ocrPromise = decodedFile
          ? updateWithdrawalOcr(withdrawalId, decodedFile.buffer, ocrBody)
          : updateWithdrawalOcrFromUrl(withdrawalId, uploaded.url, ocrBody);

        ocrPromise.catch((error) => {
          console.error("Unhandled withdrawal OCR update error:", error);
        });
      });
    }

    return res.status(201).json(responsePayload);
  } catch (error) {
    console.error("Error creating withdrawal:", error);
    if (uploadedKeyForCleanup) {
      try {
        await deleteObjectFromR2(uploadedKeyForCleanup);
      } catch (cleanupError) {
        console.error("Error cleaning up uploaded withdrawal file:", cleanupError);
      }
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
  createKtpUploadUrl,
  createKtpChunkUpload,
  appendKtpChunkUpload,
  completeKtpChunkUpload,
  createWithdrawal,
  getAllWithdrawals,
  getWithdrawalById,
  deleteWithdrawal,
};
