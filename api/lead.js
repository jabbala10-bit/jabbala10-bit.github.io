const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_TO_EMAIL = "founders@agentoslabs.com";
const DEFAULT_FROM_EMAIL = "AgentOS Labs <onboarding@resend.dev>";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://jabbala10-bit.github.io",
  "https://jabbala10-bit-github-io.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

function normalize(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getAllowedOrigins() {
  const configuredOrigins = normalize(process.env.ALLOWED_ORIGINS);

  if (!configuredOrigins) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  return configuredOrigins
    .split(",")
    .map(function (origin) {
      return origin.trim();
    })
    .filter(Boolean);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();
  const isAllowed = !origin || allowedOrigins.indexOf(origin) !== -1;

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (origin && isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  return isAllowed;
}

function buildTextEmail(lead) {
  return [
    "New strategy call request",
    "",
    "Name: " + lead.name,
    "Email: " + lead.email,
    "Company: " + lead.company,
    "Team size: " + lead.teamSize,
    "",
    "Primary use case:",
    lead.useCase
  ].join("\n");
}

function buildHtmlEmail(lead) {
  return [
    "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;\">",
    "<h2 style=\"margin:0 0 16px;\">New strategy call request</h2>",
    "<p style=\"margin:0 0 8px;\"><strong>Name:</strong> " + escapeHtml(lead.name) + "</p>",
    "<p style=\"margin:0 0 8px;\"><strong>Email:</strong> " + escapeHtml(lead.email) + "</p>",
    "<p style=\"margin:0 0 8px;\"><strong>Company:</strong> " + escapeHtml(lead.company) + "</p>",
    "<p style=\"margin:0 0 8px;\"><strong>Team size:</strong> " + escapeHtml(lead.teamSize) + "</p>",
    "<p style=\"margin:16px 0 8px;\"><strong>Primary use case</strong></p>",
    "<p style=\"margin:0;white-space:pre-wrap;\">" + escapeHtml(lead.useCase) + "</p>",
    "</div>"
  ].join("");
}

async function parseBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  return req.body;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const isAllowedOrigin = applyCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(isAllowedOrigin ? 204 : 403).end();
  }

  if (!isAllowedOrigin) {
    return res.status(403).json({ error: "Origin not allowed." });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: "Server email is not configured yet." });
  }

  let payload;

  try {
    payload = await parseBody(req);
  } catch (error) {
    return res.status(400).json({ error: "Invalid request body." });
  }

  const lead = {
    name: normalize(payload.name),
    email: normalize(payload.email),
    company: normalize(payload.company),
    teamSize: normalize(payload.teamSize),
    useCase: normalize(payload.useCase)
  };

  if (!lead.name || !lead.email || !lead.company || !lead.teamSize || !lead.useCase) {
    return res.status(400).json({ error: "Please complete every field before submitting." });
  }

  if (!isValidEmail(lead.email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  const resendResponse = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL,
      to: [process.env.LEAD_TO_EMAIL || DEFAULT_TO_EMAIL],
      subject: "Strategy Call Request - " + lead.company,
      reply_to: lead.email,
      text: buildTextEmail(lead),
      html: buildHtmlEmail(lead)
    })
  });

  let resendResult = {};

  try {
    resendResult = await resendResponse.json();
  } catch (error) {
    resendResult = {};
  }

  if (!resendResponse.ok) {
    return res.status(502).json({
      error: "Email provider rejected the request.",
      details: resendResult
    });
  }

  return res.status(200).json({ ok: true, id: resendResult.id || null });
};
