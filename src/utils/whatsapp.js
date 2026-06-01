const normalizePhoneNumber = (phoneNumber) => {
  const digits = String(phoneNumber || "").replace(/\D/g, "");

  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;

  return digits;
};

const sendWhatsAppDocument = async ({ phoneNumber, message, fileUrl, fileName }) => {
  const token = process.env.WHATSAPP_API_KEY;
  const baseUrl = (process.env.WHATSAPP_API_URL || "https://dash.ngirimwa.com/api/v1")
    .replace(/\/+$/, "");
  const apiUrl = `${baseUrl}/messages/send`;

  if (!token) {
    throw new Error("WHATSAPP_API_KEY belum dikonfigurasi.");
  }

  const target = normalizePhoneNumber(phoneNumber);
  if (!target) {
    throw new Error("Nomor WhatsApp tidak valid.");
  }

  const body = {
    to: target,
    media: fileUrl,
    media_type: "document",
    file_name: fileName,
    message,
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "x-api-key": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let payload = responseText;
  try {
    payload = JSON.parse(responseText);
  } catch (_error) {
    payload = { raw: responseText };
  }

  if (!response.ok || payload?.success === false) {
    const messageText = payload?.reason || payload?.message || response.statusText;
    throw new Error(`Kirim WhatsApp gagal (${response.status}): ${messageText}`);
  }

  return {
    target,
    response: payload,
  };
};

module.exports = {
  normalizePhoneNumber,
  sendWhatsAppDocument,
};
