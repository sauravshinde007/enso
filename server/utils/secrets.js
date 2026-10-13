// server/utils/secrets.js
// Encrypts third-party secrets (GitHub tokens, LLM API keys) before they hit MongoDB.
import crypto from "crypto";

const getKey = () => {
  const source = process.env.SECRETS_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!source) throw new Error("SECRETS_ENCRYPTION_KEY (or JWT_SECRET) must be set to store secrets");
  return crypto.createHash("sha256").update(source).digest();
};

export const encryptSecret = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
};

export const decryptSecret = (payload) => {
  if (!payload) return null;
  const [version, iv, tag, data] = payload.split(":");
  if (version !== "v1") throw new Error("Unknown secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
};

// Safe to show in the UI: "••••abcd"
export const secretHint = (plain) => (plain ? `••••${String(plain).slice(-4)}` : null);
