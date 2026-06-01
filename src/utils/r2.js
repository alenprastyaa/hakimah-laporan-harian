const crypto = require("crypto");

const R2_REGION = "auto";
const R2_SERVICE = "s3";

const safeTrimSlash = (value = "") => String(value).replace(/^\/+|\/+$/g, "");

const getR2Config = () => {
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
    throw new Error("Konfigurasi R2 belum lengkap.");
  }

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket: safeTrimSlash(bucket),
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ""),
  };
};

const formatAmzDate = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
};

const formatDateStamp = (amzDate) => amzDate.slice(0, 8);

const sha256Hex = (value) => crypto.createHash("sha256").update(value).digest("hex");

const hmac = (key, value) => crypto.createHmac("sha256", key).update(value).digest();

const getSignatureKey = (secretAccessKey, dateStamp, region, service) => {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
};

const encodeS3Path = (pathname) => {
  return pathname
    .split("/")
    .map((segment, index) => {
      if (index === 0) return segment;
      return encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`
      );
    })
    .join("/");
};

const buildCanonicalHeaders = (headers) => {
  const sortedKeys = Object.keys(headers)
    .map((key) => key.toLowerCase())
    .sort();

  const canonicalHeaders = sortedKeys
    .map((key) => `${key}:${String(headers[key]).trim().replace(/\s+/g, " ")}`)
    .join("\n");

  return {
    canonicalHeaders: `${canonicalHeaders}\n`,
    signedHeaders: sortedKeys.join(";"),
  };
};

const signRequest = ({ method, url, headers, body, accessKeyId, secretAccessKey }) => {
  const amzDate = headers["x-amz-date"];
  const dateStamp = formatDateStamp(amzDate);
  const payloadHash = headers["x-amz-content-sha256"] || sha256Hex(body);
  const canonicalUri = encodeS3Path(url.pathname);
  const canonicalQueryString = url.searchParams.toString();
  const { canonicalHeaders, signedHeaders } = buildCanonicalHeaders(headers);
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, R2_REGION, R2_SERVICE);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    authorization:
      `${algorithm} Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
};

const uploadBufferToR2 = async ({ key, buffer, contentType }) => {
  const config = getR2Config();
  const url = new URL(`${config.endpoint}/${config.bucket}/${key}`);
  const amzDate = formatAmzDate();
  const payloadHash = sha256Hex(buffer);

  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "content-type": contentType || "application/octet-stream",
  };

  const { authorization } = signRequest({
    method: "PUT",
    url,
    headers,
    body: buffer,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...headers,
      Authorization: authorization,
    },
    body: buffer,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Upload ke R2 gagal (${response.status}): ${errorText || response.statusText}`);
  }

  return {
    key,
    url: `${config.publicBaseUrl}/${key}`,
  };
};

const deleteObjectFromR2 = async (key) => {
  const config = getR2Config();
  const url = new URL(`${config.endpoint}/${config.bucket}/${key}`);
  const amzDate = formatAmzDate();
  const emptyHash = sha256Hex("");

  const headers = {
    host: url.host,
    "x-amz-content-sha256": emptyHash,
    "x-amz-date": amzDate,
  };

  const { authorization } = signRequest({
    method: "DELETE",
    url,
    headers,
    body: "",
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      ...headers,
      Authorization: authorization,
    },
  });

  if (!response.ok && response.status !== 404) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Hapus objek R2 gagal (${response.status}): ${errorText || response.statusText}`);
  }
};

const decodeBase64File = (fileData) => {
  if (typeof fileData !== "string" || !fileData.trim()) {
    throw new Error("Data file KTP tidak valid.");
  }

  const base64Match = fileData.match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = base64Match ? base64Match[1] : "application/octet-stream";
  const base64Content = base64Match ? base64Match[2] : fileData;

  return {
    mimeType,
    buffer: Buffer.from(base64Content, "base64"),
  };
};

const sanitizeFileName = (fileName) =>
  String(fileName || "ktp")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase() || "ktp";

module.exports = {
  uploadBufferToR2,
  deleteObjectFromR2,
  decodeBase64File,
  sanitizeFileName,
};
