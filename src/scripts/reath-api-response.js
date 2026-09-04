const TEMPORARY_SERVICE_MESSAGE = "Reath's data service is temporarily unavailable. Your desk data is safe; retry shortly.";
const MAX_API_ERROR_LENGTH = 320;
const UPSTREAM_FAILURE_PATTERN = /<!doctype\s+html|<html\b|cloudflare|web server is down|server lacks jwt secret|bad gateway|gateway timeout|upstream connect|error\s*52[0-9]/i;

const boundedText = (value) => String(value ?? "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, MAX_API_ERROR_LENGTH);

export const publicApiErrorMessage = (value, status = 500) => {
  const message = boundedText(value);
  if (status >= 500 || !message || UPSTREAM_FAILURE_PATTERN.test(message)) return TEMPORARY_SERVICE_MESSAGE;
  return message;
};

export const readApiResponse = async (response) => {
  const contentType = response.headers?.get?.("content-type") || "";
  let body = {};
  if (/application\/(?:[a-z.+-]*\+)?json/i.test(contentType)) {
    body = await response.json().catch(() => ({}));
  } else {
    const text = await response.text().catch(() => "");
    body = { error: boundedText(text) };
  }

  if (!response.ok) throw new Error(publicApiErrorMessage(body?.error, response.status));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(TEMPORARY_SERVICE_MESSAGE);
  }
  return body;
};

export { TEMPORARY_SERVICE_MESSAGE };
