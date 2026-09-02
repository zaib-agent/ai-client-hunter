import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const app = express();

const PORT = Number(process.env.PORT || 5000);
const NODE_ENV = process.env.NODE_ENV || "development";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const TAVILY_API_KEY = (process.env.TAVILY_API_KEY || "").trim();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_PUBLIC_KEY = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  ""
).trim();
const SUPABASE_SERVICE_ROLE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();

const FRONTEND_URLS = (
  process.env.FRONTEND_URLS ||
  process.env.FRONTEND_URL ||
  "http://localhost:5173"
).split(",").map((v) => v.trim()).filter(Boolean);

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 100);
const AI_RATE_LIMIT_MAX = Number(process.env.AI_RATE_LIMIT_MAX || 30);

const GEMINI_MAX_RETRIES = Math.max(1, Number(process.env.GEMINI_MAX_RETRIES || 4));
const GEMINI_RETRY_BASE_MS = Math.max(500, Number(process.env.GEMINI_RETRY_BASE_MS || 1800));
const TAVILY_MAX_RETRIES = Math.max(1, Number(process.env.TAVILY_MAX_RETRIES || 3));
const TAVILY_TIMEOUT_MS = Math.max(10_000, Number(process.env.TAVILY_TIMEOUT_MS || 30_000));
const AUTOPILOT_MAX_PROSPECTS = Math.max(1, Math.min(25, Number(process.env.AUTOPILOT_MAX_PROSPECTS || 10)));
const AUTOPILOT_EMAIL_DELAY_MS = Math.max(0, Number(process.env.AUTOPILOT_EMAIL_DELAY_MS || 1500));
const DAILY_EMAIL_LIMIT = Math.max(1, Number(process.env.DAILY_EMAIL_LIMIT || 25));
const AUTOPILOT_STARTUP_GRACE_MS = Math.max(
  5_000,
  Number(process.env.AUTOPILOT_STARTUP_GRACE_MS || 10_000)
);
const AUTOPILOT_JOB_TABLE = "autopilot_jobs";
const REPLY_EVENT_TABLE = "reply_events";

const AUTOPILOT_INTERVAL_MINUTES = Math.max(15, Number(process.env.AUTOPILOT_INTERVAL_MINUTES || 60));
const AUTOPILOT_MIN_SCORE = Math.min(100, Math.max(0, Number(process.env.AUTOPILOT_MIN_SCORE || 75)));

const SMTP_HOST = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE ?? "true").toLowerCase() === "true";
const SMTP_USER = (process.env.SMTP_USER || "").trim();
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = (process.env.SMTP_FROM || SMTP_USER).trim();
const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL || SMTP_USER).trim();

const IMAP_HOST = (process.env.IMAP_HOST || "").trim();
const IMAP_PORT = Number(process.env.IMAP_PORT || 993);
const IMAP_SECURE = String(process.env.IMAP_SECURE ?? "true").toLowerCase() === "true";
const IMAP_USER = (process.env.IMAP_USER || SMTP_USER).trim();
const IMAP_PASS = process.env.IMAP_PASS || "";
const REPLY_POLL_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.REPLY_POLL_INTERVAL_MS || 120_000)
);

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const supabaseAuthClient =
  SUPABASE_URL && SUPABASE_PUBLIC_KEY
    ? createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
      : null;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

function cleanString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function clamp(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : min;
}

function normalizeUrl(value) {
  const text = cleanString(value);
  if (!text) return "";
  try {
    const url = /^https?:\/\//i.test(text) ? new URL(text) : new URL(`https://${text}`);
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function extractEmails(text) {
  const matches = cleanString(text).match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  ) || [];
  return [...new Set(matches.map((e) => e.toLowerCase()))]
    .filter((e) => !/\.(png|jpg|jpeg|webp|gif)$/i.test(e));
}

function safeJsonParse(text) {
  const cleaned = cleanString(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
    }
    return null;
  }
}

function geminiText(response) {
  if (typeof response?.text === "string") return response.text;
  return response?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("") || "";
}

function leadStatus(score) {
  const n = Number(score) || 0;
  return n >= 80 ? "Hot" : n >= 60 ? "Warm" : "Cold";
}

function apiLead(row) {
  return {
    id: row.id,
    userId: row.user_id || null,
    businessName: row.business_name || "",
    industry: row.industry || "",
    location: row.location || "",
    website: row.website || "",
    contactEmail: row.contact_email || "",
    likelyNeed: row.likely_need || "",
    reason: row.reason || "",
    suggestedService: row.suggested_service || "",
    outreachAngle: row.outreach_angle || "",
    priorityScore: Number(row.priority_score || 0),
    status: row.status || "Cold",
    notes: row.notes || "",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function createUserDbClient(accessToken) {
  if (!SUPABASE_URL) return null;
  const key = SUPABASE_PUBLIC_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(SUPABASE_URL, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function requireAuth(req, res, next) {
  try {
    if (!supabaseAuthClient) {
      return res.status(503).json({ success: false, error: "Authentication service is not configured." });
    }
    const header = cleanString(req.headers.authorization);
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }
    const accessToken = cleanString(match[1]);
    const { data, error } = await supabaseAuthClient.auth.getUser(accessToken);
    if (error || !data?.user) {
      return res.status(401).json({ success: false, error: "Invalid or expired session." });
    }
    req.user = data.user;
    req.accessToken = accessToken;
    req.db = createUserDbClient(accessToken);
    if (!req.db) {
      return res.status(503).json({ success: false, error: "Database service is not configured." });
    }
    next();
  } catch (error) {
    console.error("Auth error:", error?.message || error);
    return res.status(401).json({ success: false, error: "Authentication failed." });
  }
}

function errorStatus(error) {
  return Number(
    error?.status ||
    error?.statusCode ||
    error?.code ||
    error?.response?.status ||
    error?.response?.data?.error?.code ||
    0
  );
}

function errorMessage(error) {
  return cleanString(
    error?.message ||
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    String(error || "")
  );
}

function isRetryableGeminiError(error) {
  const status = errorStatus(error);
  const message = errorMessage(error).toLowerCase();
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes("high demand") ||
    message.includes("temporarily unavailable") ||
    message.includes("unavailable") ||
    message.includes("overloaded") ||
    message.includes("rate limit") ||
    message.includes("resource exhausted")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithGemini(prompt, options = {}) {
  if (!ai) throw new Error("AI service is not configured.");

  const maxRetries = Math.max(1, Number(options.maxRetries || GEMINI_MAX_RETRIES));
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
      });
      const text = geminiText(response).trim();
      if (!text) throw new Error("AI returned an empty response.");
      return text;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableGeminiError(error);

      console.error(
        `Gemini attempt ${attempt}/${maxRetries} failed:`,
        errorMessage(error)
      );

      if (!retryable || attempt >= maxRetries) break;

      const delay = GEMINI_RETRY_BASE_MS * (2 ** (attempt - 1)) + Math.floor(Math.random() * 700);
      console.log(`Gemini temporary failure; retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  const status = errorStatus(lastError);
  if (status === 503 || isRetryableGeminiError(lastError)) {
    const err = new Error(
      `Gemini temporarily unavailable after ${maxRetries} attempts. The hunter will use its safe evidence-based fallback.`
    );
    err.code = "GEMINI_TEMPORARILY_UNAVAILABLE";
    err.status = status || 503;
    throw err;
  }

  throw lastError || new Error("AI request failed.");
}

async function tavilySearch(query, maxResults = 8) {
  if (!TAVILY_API_KEY) throw new Error("Search service is not configured.");

  let lastError = null;

  for (let attempt = 1; attempt <= TAVILY_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TAVILY_API_KEY}`,
        },
        body: JSON.stringify({
          query,
          topic: "general",
          search_depth: "advanced",
          max_results: maxResults,
          include_answer: false,
          include_raw_content: true,
          include_images: false,
        }),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(
          data?.detail || data?.error || `Tavily search failed with HTTP ${response.status}.`
        );
        error.status = response.status;
        throw error;
      }

      return Array.isArray(data?.results) ? data.results : [];
    } catch (error) {
      lastError = error;
      const status = errorStatus(error);
      const retryable = !status || status === 408 || status === 425 || status === 429 || status >= 500;

      console.error(
        `Tavily attempt ${attempt}/${TAVILY_MAX_RETRIES} failed for "${query}":`,
        errorMessage(error)
      );

      if (!retryable || attempt >= TAVILY_MAX_RETRIES) break;
      await sleep(800 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("Tavily search failed.");
}

function uniqueSources(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = cleanString(item?.url).toLowerCase() || cleanString(item?.title).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function discoverClients({ niche, location, service }) {
  const place = location || "any location";
  const queries = [
    `${niche} ${place} businesses official website`,
    `${niche} ${place} companies website contact`,
    `${niche} ${place} ${service || ""} contact email`,
    `${niche} ${place} services`,
  ];

  const batches = await Promise.allSettled(
    queries.map((query) => tavilySearch(query, 8))
  );

  const all = [];

  for (let i = 0; i < batches.length; i += 1) {
    const result = batches[i];
    if (result.status === "rejected") {
      console.error(`Tavily query ${i + 1} failed:`, errorMessage(result.reason));
      continue;
    }

    for (const item of result.value || []) {
      const rawContent = `${item?.raw_content || ""}\n${item?.content || ""}`;
      all.push({
        title: cleanString(item?.title),
        url: normalizeUrl(item?.url),
        content: cleanString(item?.raw_content || item?.content),
        emails: extractEmails(rawContent),
        searchScore: typeof item?.score === "number" ? item.score : null,
      });
    }
  }

  return uniqueSources(all)
    .filter((source) => source.url || source.title)
    .slice(0, 40);
}

function fallbackQualifyClients({ niche, location, service, sources }) {
  const seen = new Set();

  return sources
    .map((source) => {
      const text = `${source.title} ${source.content}`.toLowerCase();
      const url = normalizeUrl(source.url);
      const email = source.emails?.[0] || "";
      const title = cleanString(source.title);

      if (!title && !url) return null;

      const key = `${title}|${url}|${email}`.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);

      const officialSignals =
        Boolean(url) &&
        !/(facebook|instagram|linkedin|youtube|yelp|tripadvisor|directory|yellowpages)/i.test(url);

      const contactSignals =
        Boolean(email) ||
        /(contact|email|appointment|book|call|services|about us)/i.test(text);

      const nicheWords = cleanString(niche)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3);

      const nicheMatch = nicheWords.length
        ? nicheWords.filter((word) => text.includes(word)).length
        : 0;

      let score = 35;
      if (officialSignals) score += 20;
      if (email) score += 25;
      if (contactSignals) score += 8;
      if (nicheMatch > 0) score += 7;
      score = clamp(score, 0, 90);

      const reasonParts = [];
      if (officialSignals) reasonParts.push("A business website was found in the live search evidence.");
      if (email) reasonParts.push("A public contact email appears in the live search evidence.");
      if (nicheMatch > 0) reasonParts.push("The live result contains terms related to the requested niche.");
      if (!reasonParts.length) reasonParts.push("The business appeared in live search results.");

      return {
        businessName: title || url.replace(/^https?:\/\//, "").split("/")[0],
        industry: niche,
        location: location || "Unknown",
        website: url,
        contactEmail: email,
        likelyNeed: "",
        reason: reasonParts.join(" "),
        suggestedService: service || "",
        outreachAngle: email
          ? "Offer a short, low-friction conversation based only on the public business information."
          : "",
        priorityScore: score,
        status: leadStatus(score),
        sourceUrls: url ? [url] : [],
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, AUTOPILOT_MAX_PROSPECTS);
}

async function qualifyClients({ niche, location, service, additionalInfo, sources }) {
  const evidence = sources.map((source, i) => `
SOURCE ${i + 1}
TITLE: ${source.title}
URL: ${source.url}
EMAILS FOUND: ${source.emails.join(", ") || "none"}
CONTENT:
${source.content.slice(0, 5000)}
`).join("\n-------------------------\n");

  const prompt = `
You are the evidence-first qualification engine for an autonomous B2B client hunter.

Target niche: ${niche}
Location: ${location || "Any"}
Service: ${service || "Not specified"}
Additional requirements: ${additionalInfo || "None"}

Use ONLY the supplied live web evidence. Never invent a business, URL, owner, phone, email, metric, problem, or fact.
"likelyNeed" is a hypothesis unless directly supported.
A contactEmail may be returned ONLY if that exact email appears in the supplied evidence.
Prefer official business websites and strong-fit businesses.
Return fewer strong leads rather than weak guesses.

Return ONLY valid JSON:
{
  "prospects": [
    {
      "businessName": "string",
      "industry": "string",
      "location": "string",
      "website": "string",
      "contactEmail": "string or empty",
      "likelyNeed": "string",
      "reason": "string",
      "suggestedService": "string",
      "outreachAngle": "string",
      "priorityScore": 0,
      "sourceUrls": ["exact supplied URLs"]
    }
  ]
}

Maximum 10 prospects. priorityScore 0-100.
LIVE EVIDENCE:
${evidence}
`;

  try {
    const parsed = safeJsonParse(await generateWithGemini(prompt));
    if (!parsed || !Array.isArray(parsed.prospects)) {
      throw new Error("AI returned invalid prospect data.");
    }

    const sourceUrlSet = new Set(sources.map((s) => s.url));
    const allEmails = new Set(sources.flatMap((s) => s.emails));

    return parsed.prospects.map((item) => {
      const score = clamp(item?.priorityScore, 0, 100);
      const sourceUrls = Array.isArray(item?.sourceUrls)
        ? item.sourceUrls.filter((url) => sourceUrlSet.has(normalizeUrl(url)))
        : [];
      const email = cleanString(item?.contactEmail).toLowerCase();

      return {
        businessName: cleanString(item?.businessName),
        industry: cleanString(item?.industry) || niche,
        location: cleanString(item?.location) || location || "Unknown",
        website: normalizeUrl(item?.website),
        contactEmail: allEmails.has(email) ? email : "",
        likelyNeed: cleanString(item?.likelyNeed),
        reason: cleanString(item?.reason),
        suggestedService: cleanString(item?.suggestedService) || service,
        outreachAngle: cleanString(item?.outreachAngle),
        priorityScore: score,
        status: leadStatus(score),
        sourceUrls,
      };
    })
      .filter((p) => p.businessName)
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, AUTOPILOT_MAX_PROSPECTS);
  } catch (error) {
    console.warn("AI qualification unavailable; using evidence-based fallback:", errorMessage(error));
    return fallbackQualifyClients({ niche, location, service, sources });
  }

}

function emailTransportConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

const transporter = emailTransportConfigured()
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

async function sendEmail({ to, subject, text, replyTo }) {
  if (!transporter) throw new Error("SMTP email is not configured.");
  return transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject,
    text,
    replyTo: replyTo || undefined,
  });
}

function fallbackOutreachText(lead, sender = {}) {
  const senderName = cleanString(sender.name) || "there";
  const senderCompany = cleanString(sender.company);

  const greeting = `Hi${senderName === "there" ? "" : " " + senderName},`;

  const subject = `Quick idea for ${lead.businessName || "your business"}`;
  const service = lead.suggestedService || "our service";

  const body = [
    greeting,
    "",
    `I came across ${lead.businessName || "your business"} while researching ${lead.industry || "businesses"} in ${lead.location || "your area"}.`,
    "",
    `I work${senderCompany ? ` with ${senderCompany}` : ""} on ${service}. I had a quick idea that may be relevant to your team, and I wanted to see whether it is worth a short conversation.`,
    "",
    "If this is something you're currently exploring, I can send a few details or a simple example.",
    "",
    "Best,",
    sender.name || "AI Client Hunter",
    ...(senderCompany ? [senderCompany] : []),
  ].join("\n");

  return `Subject: ${subject}\nEmail:\n${body}`;
}

async function generateOutreachText(lead, sender = {}) {
  const senderName = cleanString(sender.name);
  const senderCompany = cleanString(sender.company);

  const prompt = `
Write a concise, natural first B2B sales email for this prospect.

Business: ${lead.businessName}
Industry: ${lead.industry || "Unknown"}
Location: ${lead.location || "Unknown"}
Website: ${lead.website || "Unknown"}
Likely need: ${lead.likelyNeed || "Unknown"}
Reason: ${lead.reason || "Unknown"}
Service offered: ${lead.suggestedService || "Professional service"}
Outreach angle: ${lead.outreachAngle || "Unknown"}

Sender name: ${senderName || "Not provided"}
Sender company: ${senderCompany || "Not provided"}

Rules:
- Use ONLY facts supplied above.
- Do not invent names, results, metrics, customers, problems, emails or other facts.
- Treat likely need as a hypothesis.
- No fake personalization.
- 100-160 words maximum.
- One clear low-friction CTA.
- Do not say "I noticed" unless the supplied evidence actually supports it.
- Return ONLY:
Subject: ...
Email:
...
`;

  try {
    return await generateWithGemini(prompt);
  } catch (error) {
    console.warn(
      `AI outreach unavailable for ${lead.businessName}; using safe fallback:`,
      errorMessage(error)
    );
    return fallbackOutreachText(lead, sender);
  }
}


async function saveLeadForUser(db, userId, prospect, notes = "") {
  const website = normalizeUrl(prospect.website);
  let duplicateQuery = db.from("leads").select("*").limit(1);
  if (website) {
    duplicateQuery = duplicateQuery.eq("website", website);
  } else {
    duplicateQuery = duplicateQuery.ilike("business_name", prospect.businessName);
  }
  const { data: duplicate, error: duplicateError } = await duplicateQuery;
  if (duplicateError) throw duplicateError;
  if (duplicate?.length) return { duplicate: true, lead: apiLead(duplicate[0]) };

  const payload = {
    user_id: userId,
    business_name: cleanString(prospect.businessName),
    industry: cleanString(prospect.industry),
    location: cleanString(prospect.location),
    website,
    contact_email: cleanString(prospect.contactEmail).toLowerCase(),
    likely_need: cleanString(prospect.likelyNeed),
    reason: cleanString(prospect.reason),
    suggested_service: cleanString(prospect.suggestedService),
    outreach_angle: cleanString(prospect.outreachAngle),
    priority_score: clamp(prospect.priorityScore, 0, 100),
    status: leadStatus(prospect.priorityScore),
    notes: notes || (prospect.contactEmail ? `Contact email: ${prospect.contactEmail}` : ""),
  };

  const { data, error } = await db.from("leads").insert(payload).select("*").single();
  if (error) throw error;
  return { duplicate: false, lead: apiLead(data) };
}

// ============================================================
// AUTONOMOUS HUNTER
// ============================================================
const autopilotJobs = new Map();
const autopilotSent = new Map();
let replyPollRunning = false;

function jobKey(userId) { return userId; }

function backgroundDb() {
  return supabaseAdmin;
}

function buildAutopilotJob(row) {
  return {
    userId: row.user_id,
    db: backgroundDb(),
    config: row.config || {},
    running: false,
    timer: null,
    lastRunAt: row.last_run_at || null,
    lastResult: row.last_result || null,
    enabled: Boolean(row.enabled),
  };
}

async function persistAutopilotJob(job) {
  if (!supabaseAdmin || !job?.userId) return;

  const payload = {
    user_id: job.userId,
    enabled: Boolean(job.enabled),
    config: job.config || {},
    last_run_at: job.lastRunAt || null,
    last_result: job.lastResult || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from(AUTOPILOT_JOB_TABLE)
    .upsert(payload, { onConflict: "user_id" });

  if (error) {
    console.warn("Persist autopilot job failed:", error.message || error);
  }
}

async function loadPersistedAutopilotJobs() {
  if (!supabaseAdmin) {
    console.warn("Persistent autopilot disabled: SUPABASE_SERVICE_ROLE_KEY is missing.");
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from(AUTOPILOT_JOB_TABLE)
    .select("*")
    .eq("enabled", true);

  if (error) {
    console.warn(
      `Could not restore autopilot jobs. Run the cloud migration first. ${error.message || error}`
    );
    return [];
  }

  return (data || []).map(buildAutopilotJob);
}

async function countEmailsSentToday(db, userId) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  try {
    const { count, error } = await db
      .from("outreach_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("sent_at", since.toISOString());

    if (error) {
      console.warn("Daily email count unavailable:", error.message || error);
      return 0;
    }

    return Number(count || 0);
  } catch (error) {
    console.warn("Daily email count failed:", errorMessage(error));
    return 0;
  }
}

async function contactedRecently(db, userId, leadId, recipientEmail) {
  try {
    let query = db
      .from("outreach_log")
      .select("id")
      .eq("user_id", userId)
      .gte("sent_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1);

    if (leadId) query = query.eq("lead_id", leadId);
    if (recipientEmail) query = query.eq("recipient_email", recipientEmail.toLowerCase());

    const { data, error } = await query;
    if (error) {
      console.warn("Recent outreach check failed:", error.message || error);
      return false;
    }

    return Boolean(data?.length);
  } catch (error) {
    console.warn("Recent outreach check failed:", errorMessage(error));
    return false;
  }
}

async function logOutreach(db, payload) {
  try {
    const { error } = await db.from("outreach_log").insert(payload);
    if (error) console.warn("Outreach log insert failed:", error.message || error);
  } catch (error) {
    console.warn("Outreach log failed:", errorMessage(error));
  }
}

async function runAutopilotJob(job) {
  if (job.running) {
    return { success: true, skipped: true, reason: "already-running" };
  }

  job.running = true;

  try {
    const sources = await discoverClients(job.config);

    if (!sources.length) {
      job.lastRunAt = new Date().toISOString();
      job.lastResult = {
        found: 0,
        strong: 0,
        saved: 0,
        emailed: 0,
        skippedEmailLimit: 0,
        message: "No usable live web results were found.",
      };
      return { success: true, ...job.lastResult };
    }

    const prospects = await qualifyClients({ ...job.config, sources });
    const strong = prospects
      .filter((p) => p.priorityScore >= AUTOPILOT_MIN_SCORE)
      .slice(0, AUTOPILOT_MAX_PROSPECTS);

    let emailed = 0;
    let saved = 0;
    let skippedEmailLimit = 0;
    let skippedRecent = 0;
    let emailFailures = 0;

    let sentToday = await countEmailsSentToday(job.db, job.userId);

    const sender = {
      name: cleanString(job.config.senderName),
      company: cleanString(job.config.senderCompany),
    };

    const sentSet = autopilotSent.get(job.userId) || new Set();
    autopilotSent.set(job.userId, sentSet);

    for (const prospect of strong) {
      const targetKey =
        `${prospect.website || prospect.businessName}|${prospect.contactEmail || ""}`.toLowerCase();

      if (sentSet.has(targetKey)) continue;

      let savedResult;

      try {
        savedResult = await saveLeadForUser(
          job.db,
          job.userId,
          prospect,
          prospect.contactEmail
            ? `Autopilot discovered public contact email: ${prospect.contactEmail}`
            : "Autopilot discovered lead. No verified public email was found."
        );

        if (!savedResult.duplicate) saved += 1;
      } catch (error) {
        console.error(
          `Lead save failed for ${prospect.businessName}:`,
          errorMessage(error)
        );
        continue;
      }

      if (!prospect.contactEmail || !emailTransportConfigured()) {
        continue;
      }

      if (sentToday >= DAILY_EMAIL_LIMIT) {
        skippedEmailLimit += 1;
        continue;
      }

      const alreadyContacted = await contactedRecently(
        job.db,
        job.userId,
        savedResult.lead?.id || null,
        prospect.contactEmail
      );

      if (alreadyContacted) {
        skippedRecent += 1;
        continue;
      }

      try {
        const message = await generateOutreachText(prospect, sender);
        const subject =
          message.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() ||
          `Quick idea for ${prospect.businessName}`;

        const body = message
          .replace(/^Subject:\s*.+$/im, "")
          .replace(/^Email:\s*/im, "")
          .trim();

        const mailResult = await sendEmail({
          to: prospect.contactEmail,
          subject,
          text: body,
          replyTo: SMTP_FROM || SMTP_USER,
        });

        emailed += 1;
        sentToday += 1;
        sentSet.add(targetKey);

        if (savedResult.lead?.id) {
          const now = new Date().toISOString();

          await job.db
            .from("leads")
            .update({
              status: "Contacted",
              contact_email: prospect.contactEmail,
              outreach_subject: subject,
              outreach_body: body,
              last_contacted_at: now,
              notes: `${savedResult.lead.notes || ""}\nAutopilot email sent: ${now}`.trim(),
              updated_at: now,
            })
            .eq("id", savedResult.lead.id)
            .eq("user_id", job.userId);

          await logOutreach(job.db, {
            user_id: job.userId,
            lead_id: savedResult.lead.id,
            recipient_email: prospect.contactEmail,
            subject,
            body,
            provider_id: cleanString(mailResult?.messageId),
            sent_at: now,
          });
        }
      } catch (error) {
        emailFailures += 1;
        console.error(
          `Autopilot email failed for ${prospect.businessName} <${prospect.contactEmail}>:`,
          errorMessage(error)
        );
      }

      if (AUTOPILOT_EMAIL_DELAY_MS > 0) {
        await sleep(AUTOPILOT_EMAIL_DELAY_MS);
      }
    }

    job.lastRunAt = new Date().toISOString();
    job.lastResult = {
      found: prospects.length,
      strong: strong.length,
      saved,
      emailed,
      skippedEmailLimit,
      skippedRecent,
      emailFailures,
      fallbackQualification: false,
    };

    return {
      success: true,
      ...job.lastResult,
      message:
        emailed > 0
          ? `Hunter found ${strong.length} strong prospects and sent ${emailed} verified-email outreach message(s).`
          : `Hunter found ${strong.length} strong prospects. No email was sent because no eligible verified-email target was available.`
    };
  } finally {
    job.running = false;
  }
}

function startAutopilotInterval(job) {
  clearInterval(job.timer);

  const intervalMs = AUTOPILOT_INTERVAL_MINUTES * 60 * 1000;

  job.timer = setInterval(() => {
    if (!job.enabled) return;

    runAutopilotJob(job)
      .then(() => persistAutopilotJob(job))
      .catch((error) =>
        console.error("Autopilot scheduled run:", errorMessage(error))
      );
  }, intervalMs);
}

async function replyEventExists(messageKey) {
  if (!supabaseAdmin) return false;

  const { data, error } = await supabaseAdmin
    .from(REPLY_EVENT_TABLE)
    .select("id")
    .eq("message_key", messageKey)
    .limit(1);

  if (error) {
    console.warn("Reply event lookup failed:", error.message || error);
    return false;
  }

  return Boolean(data?.length);
}

async function saveReplyEvent(payload) {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from(REPLY_EVENT_TABLE)
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (String(error.code) === "23505") return null;
    console.warn("Reply event save failed:", error.message || error);
    return null;
  }

  return data?.id || null;
}

async function findLeadForReply(fromEmail) {
  if (!supabaseAdmin || !fromEmail) return null;

  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("*")
    .eq("contact_email", fromEmail.toLowerCase())
    .in("status", ["Contacted", "Replied"])
    .order("last_contacted_at", { ascending: false })
    .limit(1);

  if (error) {
    console.warn("Reply lead lookup failed:", error.message || error);
    return null;
  }

  return data?.[0] || null;
}

async function pollReplies() {
  if (
    replyPollRunning ||
    !IMAP_HOST ||
    !IMAP_USER ||
    !IMAP_PASS ||
    !transporter ||
    !NOTIFY_EMAIL ||
    !supabaseAdmin
  ) {
    return;
  }

  replyPollRunning = true;

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: IMAP_SECURE,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false,
  });

  try {
    await client.connect();
    await client.mailboxOpen("INBOX");

    const unseen = await client.search({ seen: false });

    for (const uid of unseen.slice(-50)) {
      try {
        const message = await client.fetchOne(
          uid,
          { source: true, envelope: true },
          { uid: true }
        );

        if (!message?.source) continue;

        const parsed = await simpleParser(message.source);
        const fromEmail =
          parsed.from?.value?.[0]?.address?.trim().toLowerCase() || "";

        // Never touch our own outgoing messages.
        if (!fromEmail || fromEmail === SMTP_USER.toLowerCase()) {
          continue;
        }

        const subject = cleanString(parsed.subject, "(no subject)");
        const text = cleanString(parsed.text || parsed.html || "").slice(0, 12000);
        const messageId =
          cleanString(parsed.messageId) ||
          cleanString(message?.envelope?.messageId);

        const messageKey = messageId
          ? `message:${messageId}`
          : `hash:${crypto
              .createHash("sha256")
              .update(`${fromEmail}|${subject}|${text}`)
              .digest("hex")}`;

        // Already processed on a previous poll/server restart.
        if (await replyEventExists(messageKey)) {
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          continue;
        }

        // Only classify messages that can actually be matched to a contacted lead.
        const lead = await findLeadForReply(fromEmail);
        if (!lead) {
          // Leave unrelated inbox mail untouched.
          continue;
        }

        let classification = null;

        try {
          classification = safeJsonParse(
            await generateWithGemini(`
Classify this inbound B2B email reply.

Return ONLY JSON:
{
  "interested": true/false,
  "confidence": 0-100,
  "summary": "short summary",
  "suggestedReply": "short reply draft"
}

Business: ${lead.business_name}
Industry: ${lead.industry || "Unknown"}
Service originally offered: ${lead.suggested_service || "Unknown"}
Sender: ${fromEmail}
Subject: ${subject}

Reply:
${text}

Rules:
- Interested means meaningful buying curiosity, pricing, meeting, proposal, details, availability, or clear desire to continue.
- A simple thanks, acknowledgement, unsubscribe, complaint, or unrelated message is NOT interested.
- Be conservative.
- Never invent facts.
`)
          );
        } catch (error) {
          console.warn(
            `Reply AI classification failed for ${fromEmail}:`,
            errorMessage(error)
          );
        }

        const interested =
          Boolean(classification?.interested) &&
          Number(classification?.confidence || 0) >= 65;

        const eventId = await saveReplyEvent({
          user_id: lead.user_id,
          lead_id: lead.id,
          message_key: messageKey,
          from_email: fromEmail,
          subject,
          reply_text: text,
          interested,
          confidence: clamp(classification?.confidence || 0, 0, 100),
          summary: cleanString(classification?.summary),
          suggested_reply: cleanString(classification?.suggestedReply),
          processed_at: new Date().toISOString(),
        });

        if (!eventId) {
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          continue;
        }

        const now = new Date().toISOString();

        await supabaseAdmin
          .from("leads")
          .update({
            status: interested ? "Replied" : lead.status,
            notes:
              `${lead.notes || ""}\nReply received ${now}: ${cleanString(
                classification?.summary,
                "Reply received."
              )}`.trim(),
            updated_at: now,
          })
          .eq("id", lead.id)
          .eq("user_id", lead.user_id);

        if (interested) {
          await supabaseAdmin.from("notifications").insert({
            user_id: lead.user_id,
            lead_id: lead.id,
            type: "reply",
            title: `🔥 Interested client: ${lead.business_name}`,
            message:
              cleanString(classification?.summary) ||
              "The client appears interested and needs your attention.",
            from_email: fromEmail,
            subject,
            reply_text: text,
            confidence: clamp(classification?.confidence || 0, 0, 100),
            read: false,
            created_at: now,
          });

          await sendEmail({
            to: NOTIFY_EMAIL,
            subject: `🔥 Interested lead reply: ${lead.business_name}`,
            text:
`AI Client Hunter detected an interested prospect reply.

Business: ${lead.business_name}
From: ${fromEmail}
Subject: ${subject}
Confidence: ${classification?.confidence || 0}%

AI summary:
${classification?.summary || "Interested reply detected."}

Suggested reply:
${classification?.suggestedReply || "Review and reply personally."}

Original reply:
${text}`,
          });
        }

        // Mark only matched/processed client replies as seen.
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      } catch (error) {
        console.error("Reply processing failed:", errorMessage(error));
      }
    }
  } catch (error) {
    console.error("IMAP polling failed:", errorMessage(error));
  } finally {
    try {
      await client.logout();
    } catch {}
    replyPollRunning = false;
  }
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || FRONTEND_URLS.includes(origin)) return callback(null, true);
    return callback(new Error("CORS origin not allowed."));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, error: "Too many requests. Please try again later." },
});
const aiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: AI_RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, error: "AI usage limit reached. Please try again later." },
});
app.use("/api", apiLimiter);

app.get("/", (req, res) => res.json({ success: true, message: "AI Client Hunter API is running", version: "9.0.0-cloud-persistent" }));
app.get("/api/health", (req, res) => res.json({
  success: true,
  status: "healthy",
  timestamp: new Date().toISOString(),
  services: {
    gemini: Boolean(GEMINI_API_KEY),
    tavily: Boolean(TAVILY_API_KEY),
    supabase: Boolean(supabaseAuthClient),
    smtp: emailTransportConfigured(),
    imap: Boolean(IMAP_HOST && IMAP_USER && IMAP_PASS),
    smtpAccount: SMTP_USER || null,
    autopilot: true,
    persistentAutopilot: Boolean(supabaseAdmin),
    persistentReplyMonitor: Boolean(supabaseAdmin),
  },
  model: GEMINI_MODEL,
  environment: NODE_ENV,
}));
app.get("/api/config-status", (req, res) => res.json({
  success: true,
  services: {
    gemini: Boolean(GEMINI_API_KEY),
    tavily: Boolean(TAVILY_API_KEY),
    supabase: Boolean(supabaseAuthClient),
    smtp: emailTransportConfigured(),
    imap: Boolean(IMAP_HOST && IMAP_USER && IMAP_PASS),
    persistentAutopilot: Boolean(supabaseAdmin),
    persistentReplyMonitor: Boolean(supabaseAdmin),
  },
  autopilotIntervalMinutes: AUTOPILOT_INTERVAL_MINUTES,
  autopilotMinScore: AUTOPILOT_MIN_SCORE,
  model: GEMINI_MODEL,
}));
app.get("/api/notifications", requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.db
      .from("notifications")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({ success: true, notifications: data || [] });
  } catch (error) {
    console.error("Notifications:", errorMessage(error));
    res.status(500).json({
      success: false,
      error: "Failed to load notifications.",
    });
  }
});

app.patch("/api/notifications/:id/read", requireAuth, async (req, res) => {
  try {
    const { error } = await req.db
      .from("notifications")
      .update({ read: true })
      .eq("id", cleanString(req.params.id))
      .eq("user_id", req.user.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("Notification read:", errorMessage(error));
    res.status(500).json({
      success: false,
      error: "Failed to update notification.",
    });
  }
});

app.get("/api/me", requireAuth, (req, res) => res.json({
  success: true,
  user: { id: req.user.id, email: req.user.email || null },
}));

app.post("/api/generate", requireAuth, aiLimiter, async (req, res) => {
  try {
    const prompt = cleanString(req.body?.prompt);
    if (!prompt) return res.status(400).json({ success: false, error: "Prompt is required." });
    return res.json({ success: true, text: await generateWithGemini(prompt) });
  } catch (error) {
    console.error("Generate error:", error?.message || error);
    return res.status(500).json({ success: false, error: "AI request failed." });
  }
});

app.post("/api/hunt", requireAuth, aiLimiter, async (req, res) => {
  try {
    const niche = cleanString(req.body?.niche);
    const location = cleanString(req.body?.location);
    const service = cleanString(req.body?.service);
    const additionalInfo = cleanString(req.body?.additionalInfo);
    const senderName = cleanString(req.body?.senderName);
    const senderCompany = cleanString(req.body?.senderCompany);
    if (!niche) return res.status(400).json({ success: false, error: "Niche is required." });

    const sources = await discoverClients({ niche, location, service });
    if (!sources.length) return res.json({ success: true, prospects: [], sources: [], sourceCount: 0 });

    const prospects = await qualifyClients({ niche, location, service, additionalInfo, sources });
    res.json({
      success: true,
      prospects,
      sourceCount: sources.length,
      sources: sources.map((s) => ({ title: s.title, url: s.url })),
    });
  } catch (error) {
    console.error("Hunter error:", error?.message || error);
    res.status(500).json({ success: false, error: "Client hunt failed." });
  }
});

app.get("/api/leads", requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.db.from("leads").select("*").eq("user_id", req.user.id).order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, leads: (data || []).map(apiLead) });
  } catch (error) {
    console.error("Load leads:", error?.message || error);
    res.status(500).json({ success: false, error: "Failed to load leads." });
  }
});

app.post("/api/leads", requireAuth, async (req, res) => {
  try {
    const prospect = req.body || {};
    if (!cleanString(prospect.businessName)) return res.status(400).json({ success: false, error: "Business name is required." });
    const result = await saveLeadForUser(req.db, req.user.id, prospect);
    if (result.duplicate) return res.status(409).json({ success: false, duplicate: true, error: "This lead is already saved." });
    res.status(201).json({ success: true, lead: result.lead });
  } catch (error) {
    console.error("Save lead:", error?.message || error);
    res.status(500).json({ success: false, error: "Failed to save lead." });
  }
});

app.patch("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    const id = cleanString(req.params.id);
    const updates = { updated_at: new Date().toISOString() };
    if (typeof req.body?.notes === "string") updates.notes = req.body.notes.trim();
    if (typeof req.body?.status === "string") {
      const allowed = ["Hot", "Warm", "Cold", "Contacted", "Replied", "Won", "Lost"];
      if (!allowed.includes(req.body.status)) return res.status(400).json({ success: false, error: "Invalid status." });
      updates.status = req.body.status;
    }
    const { data, error } = await req.db.from("leads").update(updates).eq("id", id).eq("user_id", req.user.id).select("*").single();
    if (error) throw error;
    res.json({ success: true, lead: apiLead(data) });
  } catch (error) {
    console.error("Update lead:", error?.message || error);
    res.status(500).json({ success: false, error: "Failed to update lead." });
  }
});

app.delete("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    const { error } = await req.db.from("leads").delete().eq("id", cleanString(req.params.id)).eq("user_id", req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("Delete lead:", error?.message || error);
    res.status(500).json({ success: false, error: "Failed to delete lead." });
  }
});

app.post("/api/outreach", requireAuth, aiLimiter, async (req, res) => {
  try {
    const lead = req.body?.lead || {};
    const channel = cleanString(req.body?.channel, "Email");
    if (!["Email", "WhatsApp", "LinkedIn"].includes(channel)) return res.status(400).json({ success: false, error: "Invalid outreach channel." });
    if (!cleanString(lead.businessName)) return res.status(400).json({ success: false, error: "Lead information is required." });

    const text = await generateWithGemini(`
Write a personalized ${channel} outreach message.
Business: ${lead.businessName}
Industry: ${lead.industry || "Unknown"}
Location: ${lead.location || "Unknown"}
Website: ${lead.website || "Unknown"}
Likely need: ${lead.likelyNeed || "Unknown"}
Why: ${lead.reason || "Unknown"}
Service: ${lead.suggestedService || "Professional services"}
Angle: ${lead.outreachAngle || "Unknown"}
Never invent facts, names, metrics, emails or phone numbers. Treat likely need as a hypothesis.
If Email, return Subject + Email. Otherwise return only the message.
`);
    res.json({ success: true, channel, text });
  } catch (error) {
    console.error("Outreach:", error?.message || error);
    res.status(500).json({ success: false, error: "Outreach generation failed." });
  }
});

app.get("/api/autopilot/status", requireAuth, async (req, res) => {
  try {
    const job = autopilotJobs.get(jobKey(req.user.id));

    if (job) {
      return res.json({
        success: true,
        active: Boolean(job.enabled),
        config: job.config || null,
        lastRunAt: job.lastRunAt || null,
        lastResult: job.lastResult || null,
        intervalMinutes: AUTOPILOT_INTERVAL_MINUTES,
        minScore: AUTOPILOT_MIN_SCORE,
        emailReady: emailTransportConfigured(),
        replyMonitorReady: Boolean(
          IMAP_HOST &&
          IMAP_USER &&
          IMAP_PASS &&
          NOTIFY_EMAIL &&
          supabaseAdmin
        ),
        persistent: Boolean(supabaseAdmin),
      });
    }

    if (supabaseAdmin) {
      const { data } = await supabaseAdmin
        .from(AUTOPILOT_JOB_TABLE)
        .select("*")
        .eq("user_id", req.user.id)
        .eq("enabled", true)
        .maybeSingle();

      if (data) {
        return res.json({
          success: true,
          active: true,
          config: data.config || null,
          lastRunAt: data.last_run_at || null,
          lastResult: data.last_result || null,
          intervalMinutes: AUTOPILOT_INTERVAL_MINUTES,
          minScore: AUTOPILOT_MIN_SCORE,
          emailReady: emailTransportConfigured(),
          replyMonitorReady: Boolean(
            IMAP_HOST &&
            IMAP_USER &&
            IMAP_PASS &&
            NOTIFY_EMAIL &&
            supabaseAdmin
          ),
          persistent: true,
        });
      }
    }

    res.json({
      success: true,
      active: false,
      config: null,
      lastRunAt: null,
      lastResult: null,
      intervalMinutes: AUTOPILOT_INTERVAL_MINUTES,
      minScore: AUTOPILOT_MIN_SCORE,
      emailReady: emailTransportConfigured(),
      replyMonitorReady: Boolean(
        IMAP_HOST &&
        IMAP_USER &&
        IMAP_PASS &&
        NOTIFY_EMAIL &&
        supabaseAdmin
      ),
      persistent: Boolean(supabaseAdmin),
    });
  } catch (error) {
    console.error("Autopilot status:", errorMessage(error));
    res.status(500).json({
      success: false,
      error: errorMessage(error) || "Unable to read autopilot status.",
    });
  }
});

app.post("/api/autopilot/start", requireAuth, async (req, res) => {
  try {
    const niche = cleanString(req.body?.niche);
    const location = cleanString(req.body?.location);
    const service = cleanString(req.body?.service);
    const additionalInfo = cleanString(req.body?.additionalInfo);
    const senderName = cleanString(req.body?.senderName);
    const senderCompany = cleanString(req.body?.senderCompany);

    if (!niche) {
      return res.status(400).json({ success: false, error: "Niche is required." });
    }

    if (!emailTransportConfigured()) {
      return res.status(503).json({
        success: false,
        error: "SMTP email is not configured. Add SMTP settings first.",
      });
    }

    if (!supabaseAdmin) {
      return res.status(503).json({
        success: false,
        error: "Persistent cloud mode requires SUPABASE_SERVICE_ROLE_KEY on the backend.",
      });
    }

    const existing = autopilotJobs.get(jobKey(req.user.id));
    if (existing) clearInterval(existing.timer);

    const job = {
      userId: req.user.id,
      db: supabaseAdmin,
      config: {
        niche,
        location,
        service,
        additionalInfo,
        senderName,
        senderCompany,
      },
      running: false,
      timer: null,
      lastRunAt: null,
      lastResult: null,
      enabled: true,
    };

    autopilotJobs.set(jobKey(req.user.id), job);
    await persistAutopilotJob(job);
    startAutopilotInterval(job);

    const firstRun = await runAutopilotJob(job);
    await persistAutopilotJob(job);

    res.json({
      success: true,
      active: true,
      persistent: true,
      firstRun,
      intervalMinutes: AUTOPILOT_INTERVAL_MINUTES,
      minScore: AUTOPILOT_MIN_SCORE,
    });
  } catch (error) {
    console.error("Autopilot start:", errorMessage(error));
    res.status(500).json({
      success: false,
      error: errorMessage(error) || "Unable to start autonomous hunter.",
      code: error?.code || null,
      status: errorStatus(error) || null,
    });
  }
});

app.post("/api/autopilot/run-now", requireAuth, async (req, res) => {
  try {
    let job = autopilotJobs.get(jobKey(req.user.id));

    if (!job && supabaseAdmin) {
      const { data } = await supabaseAdmin
        .from(AUTOPILOT_JOB_TABLE)
        .select("*")
        .eq("user_id", req.user.id)
        .eq("enabled", true)
        .maybeSingle();

      if (data) {
        job = buildAutopilotJob(data);
        autopilotJobs.set(jobKey(req.user.id), job);
        startAutopilotInterval(job);
      }
    }

    const config = job?.config || {
      niche: cleanString(req.body?.niche),
      location: cleanString(req.body?.location),
      service: cleanString(req.body?.service),
      additionalInfo: cleanString(req.body?.additionalInfo),
      senderName: cleanString(req.body?.senderName),
      senderCompany: cleanString(req.body?.senderCompany),
    };

    if (!config.niche) {
      return res.status(400).json({
        success: false,
        error: "Niche is required.",
      });
    }

    const transientJob = job || {
      userId: req.user.id,
      db: supabaseAdmin || req.db,
      config,
      running: false,
      timer: null,
      lastRunAt: null,
      lastResult: null,
      enabled: false,
    };

    const result = await runAutopilotJob(transientJob);

    if (job) {
      await persistAutopilotJob(job);
    }

    res.json({ success: true, persistent: Boolean(job), ...result });
  } catch (error) {
    console.error("Autopilot run-now:", errorMessage(error));
    res.status(500).json({
      success: false,
      error: errorMessage(error) || "Autonomous hunt failed.",
      code: error?.code || null,
      status: errorStatus(error) || null,
    });
  }
});

app.post("/api/autopilot/stop", requireAuth, async (req, res) => {
  try {
    const job = autopilotJobs.get(jobKey(req.user.id));

    if (job) {
      job.enabled = false;
      clearInterval(job.timer);
      autopilotJobs.delete(jobKey(req.user.id));
    }

    if (supabaseAdmin) {
      const { error } = await supabaseAdmin
        .from(AUTOPILOT_JOB_TABLE)
        .update({
          enabled: false,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", req.user.id);

      if (error) console.warn("Persist autopilot stop failed:", error.message || error);
    }

    res.json({ success: true, active: false, persistent: Boolean(supabaseAdmin) });
  } catch (error) {
    console.error("Autopilot stop:", errorMessage(error));
    res.status(500).json({
      success: false,
      error: errorMessage(error) || "Unable to stop autopilot.",
    });
  }
});

app.post("/api/email/test", requireAuth, async (req, res) => {
  try {
    if (!emailTransportConfigured()) {
      return res.status(503).json({
        success: false,
        error: "SMTP is not configured. Check SMTP_HOST, SMTP_USER and SMTP_PASS.",
      });
    }

    const to = cleanString(req.body?.to) || NOTIFY_EMAIL || req.user.email;
    if (!to) {
      return res.status(400).json({
        success: false,
        error: "Test email recipient is missing.",
      });
    }

    await transporter.verify();

    const result = await sendEmail({
      to,
      subject: "AI Client Hunter — email test",
      text:
        "Email delivery is working. AI Client Hunter can send outreach from the configured SMTP account.",
    });

    res.json({
      success: true,
      sentTo: to,
      messageId: cleanString(result?.messageId),
    });
  } catch (error) {
    console.error("Email test:", errorMessage(error));
    res.status(502).json({
      success: false,
      error: `SMTP test failed: ${errorMessage(error) || "Unknown SMTP error."}`,
    });
  }
});

app.use((req, res) => res.status(404).json({ success: false, error: "Route not found." }));
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error?.message || error);
  if (res.headersSent) return next(error);
  res.status(500).json({ success: false, error: "Internal server error." });
});

async function restoreAutopilotAfterStartup() {
  const jobs = await loadPersistedAutopilotJobs();

  if (!jobs.length) {
    console.log("Persistent Autopilot: no active jobs to restore.");
    return;
  }

  console.log(`Persistent Autopilot: restoring ${jobs.length} active job(s)...`);

  for (const job of jobs) {
    autopilotJobs.set(jobKey(job.userId), job);
    startAutopilotInterval(job);

    setTimeout(() => {
      if (!job.enabled) return;

      runAutopilotJob(job)
        .then(() => persistAutopilotJob(job))
        .catch((error) =>
          console.error(
            `Restored Autopilot run failed for ${job.userId}:`,
            errorMessage(error)
          )
        );
    }, AUTOPILOT_STARTUP_GRACE_MS);
  }
}

app.listen(PORT, "0.0.0.0", async () => {
  console.log("==============================================");
  console.log("AI CLIENT HUNTER V9 — CLOUD PERSISTENT AGENT");
  console.log(`Server: 0.0.0.0:${PORT}`);
  console.log(`Gemini: ${GEMINI_API_KEY ? "CONNECTED" : "NOT CONFIGURED"}`);
  console.log(`Tavily: ${TAVILY_API_KEY ? "CONNECTED" : "NOT CONFIGURED"}`);
  console.log(`Supabase: ${supabaseAuthClient ? "CONNECTED" : "NOT CONFIGURED"}`);
  console.log(`Supabase Admin: ${supabaseAdmin ? "CONNECTED" : "NOT CONFIGURED"}`);
  console.log(`SMTP: ${emailTransportConfigured() ? "CONNECTED" : "NOT CONFIGURED"}`);
  console.log(`IMAP: ${IMAP_HOST && IMAP_USER && IMAP_PASS ? "CONNECTED" : "NOT CONFIGURED"}`);
  console.log(`Persistent Autopilot: ${supabaseAdmin ? "ENABLED" : "DISABLED"}`);
  console.log(`Persistent Reply Monitor: ${supabaseAdmin ? "ENABLED" : "DISABLED"}`);
  console.log(`Autopilot interval: ${AUTOPILOT_INTERVAL_MINUTES} minutes`);
  console.log(`Autopilot minimum score: ${AUTOPILOT_MIN_SCORE}`);
  console.log(`Daily email limit: ${DAILY_EMAIL_LIMIT}`);
  console.log(`Gemini retries: ${GEMINI_MAX_RETRIES}`);
  console.log("==============================================");

  if (transporter) {
    transporter.verify()
      .then(() => console.log("SMTP verification: SUCCESS"))
      .catch((error) => console.error("SMTP verification: FAILED —", errorMessage(error)));
  }

  if (IMAP_HOST && IMAP_USER && IMAP_PASS && transporter && supabaseAdmin) {
    setInterval(() => {
      pollReplies().catch((error) =>
        console.error("Reply monitor:", errorMessage(error))
      );
    }, REPLY_POLL_INTERVAL_MS);

    pollReplies().catch((error) =>
      console.error("Initial reply monitor:", errorMessage(error))
    );
  } else {
    console.log(
      "Reply monitor not started: requires IMAP + SMTP + SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  await restoreAutopilotAfterStartup();
});
