import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();

// ============================================================
// ENVIRONMENT
// ============================================================

const PORT = Number(
  process.env.PORT || 5000
);

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-3.6-flash";

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || "";

const TAVILY_API_KEY =
  process.env.TAVILY_API_KEY || "";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const FRONTEND_URLS = (
  process.env.FRONTEND_URLS ||
  process.env.FRONTEND_URL ||
  "http://localhost:5173"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const RATE_LIMIT_WINDOW_MS =
  Number(
    process.env.RATE_LIMIT_WINDOW_MS ||
      15 * 60 * 1000
  );

const RATE_LIMIT_MAX =
  Number(
    process.env.RATE_LIMIT_MAX || 100
  );

// ============================================================
// CLIENTS
// ============================================================

const ai = GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
    })
  : null;

const supabase =
  SUPABASE_URL &&
  SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        }
      )
    : null;

// ============================================================
// BASIC SECURITY
// ============================================================

app.disable("x-powered-by");

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  })
);

// ============================================================
// CORS
// ============================================================

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server / health checks with no browser origin.
      if (!origin) {
        return callback(null, true);
      }

      if (
        FRONTEND_URLS.includes(origin)
      ) {
        return callback(null, true);
      }

      return callback(
        new Error("CORS origin not allowed.")
      );
    },

    credentials: false,

    methods: [
      "GET",
      "POST",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

// ============================================================
// BODY PARSING
// ============================================================

app.use(
  express.json({
    limit: "10mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);

// ============================================================
// RATE LIMITING
// ============================================================

const apiLimiter =
  rateLimit({
    windowMs:
      RATE_LIMIT_WINDOW_MS,

    limit:
      RATE_LIMIT_MAX,

    standardHeaders:
      "draft-8",

    legacyHeaders:
      false,

    message: {
      success: false,
      error:
        "Too many requests. Please try again later.",
    },
  });

app.use(
  "/api",
  apiLimiter
);

// ============================================================
// HELPERS
// ============================================================

function cleanString(
  value,
  fallback = ""
) {
  if (
    typeof value !== "string"
  ) {
    return fallback;
  }

  return value.trim();
}

function clamp(
  value,
  min,
  max
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return min;
  }

  return Math.min(
    Math.max(
      number,
      min
    ),
    max
  );
}

function normalizeUrl(
  url
) {
  if (
    !url ||
    typeof url !== "string"
  ) {
    return "";
  }

  const value =
    url.trim();

  if (!value) {
    return "";
  }

  if (
    value.startsWith(
      "http://"
    ) ||
    value.startsWith(
      "https://"
    )
  ) {
    return value;
  }

  return `https://${value}`;
}

function getLeadStatus(
  score
) {
  const numericScore =
    Number(score) || 0;

  if (
    numericScore >= 80
  ) {
    return "Hot";
  }

  if (
    numericScore >= 60
  ) {
    return "Warm";
  }

  return "Cold";
}

function removeCodeFences(
  text
) {
  return cleanString(text)
    .replace(
      /^```json\s*/i,
      ""
    )
    .replace(
      /^```\s*/i,
      ""
    )
    .replace(
      /\s*```$/i,
      ""
    )
    .trim();
}

function safeJsonParse(
  text
) {
  const cleaned =
    removeCodeFences(text);

  try {
    return JSON.parse(
      cleaned
    );
  } catch {
    const start =
      cleaned.indexOf("{");

    const end =
      cleaned.lastIndexOf("}");

    if (
      start !== -1 &&
      end !== -1
    ) {
      try {
        return JSON.parse(
          cleaned.slice(
            start,
            end + 1
          )
        );
      } catch {
        return null;
      }
    }

    return null;
  }
}

function getGeminiText(
  response
) {
  if (!response) {
    return "";
  }

  if (
    typeof response.text ===
    "string"
  ) {
    return response.text;
  }

  return (
    response?.candidates?.[0]
      ?.content?.parts
      ?.map(
        (part) =>
          part?.text || ""
      )
      .join("") || ""
  );
}

function uniqueSearchResults(
  results
) {
  const seen =
    new Set();

  return results.filter(
    (item) => {
      const key =
        cleanString(
          item?.url
        ).toLowerCase() ||
        cleanString(
          item?.title
        ).toLowerCase();

      if (
        !key ||
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
}

function dbLeadToApi(
  lead
) {
  return {
    id:
      lead.id,

    userId:
      lead.user_id || null,

    businessName:
      lead.business_name ||
      "",

    industry:
      lead.industry ||
      "",

    location:
      lead.location ||
      "",

    website:
      lead.website ||
      "",

    likelyNeed:
      lead.likely_need ||
      "",

    reason:
      lead.reason ||
      "",

    suggestedService:
      lead.suggested_service ||
      "",

    outreachAngle:
      lead.outreach_angle ||
      "",

    priorityScore:
      Number(
        lead.priority_score ||
          0
      ),

    status:
      lead.status ||
      "Cold",

    notes:
      lead.notes ||
      "",

    createdAt:
      lead.created_at ||
      null,

    updatedAt:
      lead.updated_at ||
      null,
  };
}

// ============================================================
// AUTHENTICATION
// ============================================================

async function requireAuth(
  req,
  res,
  next
) {
  try {
    if (!supabase) {
      return res
        .status(503)
        .json({
          success: false,
          error:
            "Authentication service is not configured.",
        });
    }

    const authorization =
      cleanString(
        req.headers.authorization
      );

    if (!authorization) {
      return res
        .status(401)
        .json({
          success: false,
          error:
            "Authentication required.",
        });
    }

    const match =
      authorization.match(
        /^Bearer\s+(.+)$/i
      );

    if (!match) {
      return res
        .status(401)
        .json({
          success: false,
          error:
            "Invalid authorization header.",
        });
    }

    const accessToken =
      cleanString(
        match[1]
      );

    if (!accessToken) {
      return res
        .status(401)
        .json({
          success: false,
          error:
            "Authentication token is missing.",
        });
    }

    const {
      data,
      error,
    } =
      await supabase.auth.getUser(
        accessToken
      );

    if (
      error ||
      !data?.user
    ) {
      console.warn(
        "Authentication rejected:",
        error?.message ||
          "Invalid user."
      );

      return res
        .status(401)
        .json({
          success: false,
          error:
            "Invalid or expired session.",
        });
    }

    req.user =
      data.user;

    req.accessToken =
      accessToken;

    return next();
  } catch (error) {
    console.error(
      "Authentication middleware error:",
      error
    );

    return res
      .status(401)
      .json({
        success: false,
        error:
          "Authentication failed.",
      });
  }
}

// ============================================================
// ROOT
// ============================================================

app.get(
  "/",
  (req, res) => {
    return res.json({
      success: true,

      message:
        "AI Client Hunter API is running",

      version:
        "6.2.0",
    });
  }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/api/health",
  (req, res) => {
    return res.json({
      success: true,

      status:
        "healthy",

      timestamp:
        new Date().toISOString(),

      services: {
        gemini:
          Boolean(
            GEMINI_API_KEY
          ),

        tavily:
          Boolean(
            TAVILY_API_KEY
          ),

        supabase:
          Boolean(
            supabase
          ),
      },

      model:
        GEMINI_MODEL,

      environment:
        process.env.NODE_ENV ||
        "development",
    });
  }
);

// ============================================================
// CONFIG STATUS
// ============================================================

app.get(
  "/api/config-status",
  (req, res) => {
    return res.json({
      success: true,

      status:
        "configured",

      services: {
        gemini:
          Boolean(
            GEMINI_API_KEY
          ),

        tavily:
          Boolean(
            TAVILY_API_KEY
          ),

        supabase:
          Boolean(
            supabase
          ),
      },

      model:
        GEMINI_MODEL,
    });
  }
);

// ============================================================
// CURRENT USER
// ============================================================

app.get(
  "/api/me",
  requireAuth,
  (req, res) => {
    return res.json({
      success: true,

      user: {
        id:
          req.user.id,

        email:
          req.user.email ||
          null,
      },
    });
  }
);

// ============================================================
// GEMINI
// ============================================================

async function generateWithGemini(
  prompt
) {
  if (!ai) {
    throw new Error(
      "AI service is not configured."
    );
  }

  const response =
    await ai.models.generateContent({
      model:
        GEMINI_MODEL,

      contents:
        prompt,
    });

  const text =
    getGeminiText(
      response
    ).trim();

  if (!text) {
    throw new Error(
      "AI returned an empty response."
    );
  }

  return text;
}

app.post(
  "/api/generate",
  requireAuth,
  async (req, res) => {
    try {
      const prompt =
        cleanString(
          req.body?.prompt
        );

      if (!prompt) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Prompt is required.",
          });
      }

      const text =
        await generateWithGemini(
          prompt
        );

      return res.json({
        success: true,
        text,
      });
    } catch (error) {
      console.error(
        "Generate error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          error:
            "AI request failed.",
        });
    }
  }
);

// ============================================================
// TAVILY SEARCH
// ============================================================

async function tavilySearch(
  query,
  maxResults = 7
) {
  if (!TAVILY_API_KEY) {
    throw new Error(
      "Search service is not configured."
    );
  }

  const response =
    await fetch(
      "https://api.tavily.com/search",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${TAVILY_API_KEY}`,
        },

        body:
          JSON.stringify({
            query,

            topic:
              "general",

            search_depth:
              "basic",

            max_results:
              maxResults,

            include_answer:
              false,

            include_raw_content:
              false,

            include_images:
              false,
          }),
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.detail ||
        data?.error ||
        "Tavily search failed."
    );
  }

  return Array.isArray(
    data?.results
  )
    ? data.results
    : [];
}

// ============================================================
// CLIENT DISCOVERY
// ============================================================

async function discoverClients({
  niche,
  location,
  service,
}) {
  const place =
    location ||
    "any location";

  const queries = [
    `${niche} ${place} businesses`,
    `${niche} ${place} companies website`,
    `${niche} ${place} services`,
    service
      ? `${niche} ${place} ${service}`
      : `${niche} ${place}`,
  ];

  const collected =
    [];

  for (
    const query of queries
  ) {
    try {
      const results =
        await tavilySearch(
          query,
          6
        );

      collected.push(
        ...results.map(
          (item) => ({
            title:
              cleanString(
                item?.title
              ),

            url:
              normalizeUrl(
                item?.url
              ),

            content:
              cleanString(
                item?.content
              ),

            searchScore:
              typeof item?.score ===
              "number"
                ? item.score
                : null,
          })
        )
      );
    } catch (error) {
      console.error(
        `Search failed for "${query}":`,
        error?.message
      );
    }
  }

  return uniqueSearchResults(
    collected
  ).slice(
    0,
    20
  );
}

// ============================================================
// QUALIFICATION
// ============================================================

async function qualifyClients({
  niche,
  location,
  service,
  additionalInfo,
  sources,
}) {
  const evidence =
    sources
      .map(
        (
          source,
          index
        ) => `
SOURCE ${index + 1}

TITLE:
${source.title}

URL:
${source.url}

SEARCH CONTENT:
${source.content}
`
      )
      .join(
        "\n----------------------\n"
      );

  const prompt = `
You are the research and qualification engine for AI Client Hunter.

The supplied information below comes from live Tavily web search.

Identify genuine business prospects supported by the supplied evidence.

TARGET NICHE:
${niche}

LOCATION:
${location || "Any"}

SERVICE BEING SOLD:
${service || "Not specified"}

ADDITIONAL REQUIREMENTS:
${additionalInfo || "None"}

LIVE WEB EVIDENCE:

${evidence}

STRICT ACCURACY RULES:

- Never invent businesses.
- Never invent URLs.
- Never invent owner names.
- Never invent emails.
- Never invent phone numbers.
- Never claim an unsupported business problem as fact.
- "Likely Need" is a sales hypothesis unless directly evidenced.
- Every prospect must be supported by supplied web evidence.
- Do not duplicate businesses.
- Prefer fewer strong prospects.
- Score conservatively.
- High score requires strong fit and evidence.
- Do not present AI hypotheses as confirmed facts.

Return ONLY valid JSON.

Format:

{
  "prospects": [
    {
      "businessName": "string",
      "industry": "string",
      "location": "string",
      "website": "string",
      "likelyNeed": "string",
      "reason": "string",
      "suggestedService": "string",
      "outreachAngle": "string",
      "priorityScore": 0
    }
  ]
}

priorityScore must be between 0 and 100.

Return maximum 8 strong prospects.
`;

  const text =
    await generateWithGemini(
      prompt
    );

  const parsed =
    safeJsonParse(text);

  if (
    !parsed ||
    !Array.isArray(
      parsed.prospects
    )
  ) {
    throw new Error(
      "AI returned invalid prospect data."
    );
  }

  return parsed.prospects;
}

// ============================================================
// HUNT
// ============================================================

app.post(
  "/api/hunt",
  requireAuth,
  async (req, res) => {
    try {
      const niche =
        cleanString(
          req.body?.niche
        );

      const location =
        cleanString(
          req.body?.location
        );

      const service =
        cleanString(
          req.body?.service
        );

      const additionalInfo =
        cleanString(
          req.body?.additionalInfo
        );

      if (!niche) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Niche is required.",
          });
      }

      const sources =
        await discoverClients({
          niche,
          location,
          service,
        });

      if (
        !sources.length
      ) {
        return res.json({
          success: true,
          prospects: [],
          sources: [],
          sourceCount: 0,
        });
      }

      const rawProspects =
        await qualifyClients({
          niche,
          location,
          service,
          additionalInfo,
          sources,
        });

      const prospects =
        rawProspects
          .map(
            (item) => {
              const score =
                clamp(
                  item?.priorityScore,
                  0,
                  100
                );

              return {
                businessName:
                  cleanString(
                    item?.businessName
                  ),

                industry:
                  cleanString(
                    item?.industry
                  ) ||
                  niche,

                location:
                  cleanString(
                    item?.location
                  ) ||
                  location ||
                  "Unknown",

                website:
                  normalizeUrl(
                    cleanString(
                      item?.website
                    )
                  ),

                likelyNeed:
                  cleanString(
                    item?.likelyNeed
                  ),

                reason:
                  cleanString(
                    item?.reason
                  ),

                suggestedService:
                  cleanString(
                    item?.suggestedService
                  ) ||
                  service,

                outreachAngle:
                  cleanString(
                    item?.outreachAngle
                  ),

                priorityScore:
                  score,

                status:
                  getLeadStatus(
                    score
                  ),
              };
            }
          )
          .filter(
            (item) =>
              item.businessName
          )
          .sort(
            (a, b) =>
              b.priorityScore -
              a.priorityScore
          );

      return res.json({
        success: true,

        prospects,

        sourceCount:
          sources.length,

        sources:
          sources.map(
            (source) => ({
              title:
                source.title,

              url:
                source.url,
            })
          ),
      });
    } catch (error) {
      console.error(
        "Hunter error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          error:
            "Client hunt failed.",
        });
    }
  }
);

// ============================================================
// LEADS — GET OWN LEADS
// ============================================================

app.get(
  "/api/leads",
  requireAuth,
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error(
          "Database service is not configured."
        );
      }

      const {
        data,
        error,
      } =
        await supabase
          .from("leads")
          .select("*")
          .eq(
            "user_id",
            req.user.id
          )
          .order(
            "created_at",
            {
              ascending:
                false,
            }
          );

      if (error) {
        throw error;
      }

      return res.json({
        success: true,

        leads:
          (data || []).map(
            dbLeadToApi
          ),
      });
    } catch (error) {
      console.error(
        "Load leads error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          error:
            "Failed to load leads.",
        });
    }
  }
);

// ============================================================
// LEADS — CREATE OWN LEAD
// ============================================================

app.post(
  "/api/leads",
  requireAuth,
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error(
          "Database service is not configured."
        );
      }

      const businessName =
        cleanString(
          req.body?.businessName
        );

      if (!businessName) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Business name is required.",
          });
      }

      const website =
        normalizeUrl(
          cleanString(
            req.body?.website
          )
        );

      let duplicateQuery =
        supabase
          .from("leads")
          .select(
            "id,business_name,website"
          )
          .eq(
            "user_id",
            req.user.id
          )
          .limit(1);

      if (website) {
        duplicateQuery =
          duplicateQuery.eq(
            "website",
            website
          );
      } else {
        duplicateQuery =
          duplicateQuery.ilike(
            "business_name",
            businessName
          );
      }

      const {
        data: duplicates,
        error:
          duplicateError,
      } =
        await duplicateQuery;

      if (duplicateError) {
        throw duplicateError;
      }

      if (
        Array.isArray(
          duplicates
        ) &&
        duplicates.length
      ) {
        return res
          .status(409)
          .json({
            success: false,
            duplicate: true,
            error:
              "This lead is already saved.",
          });
      }

      const priorityScore =
        clamp(
          req.body?.priorityScore,
          0,
          100
        );

      const payload = {
        user_id:
          req.user.id,

        business_name:
          businessName,

        industry:
          cleanString(
            req.body?.industry
          ),

        location:
          cleanString(
            req.body?.location
          ),

        website,

        likely_need:
          cleanString(
            req.body?.likelyNeed
          ),

        reason:
          cleanString(
            req.body?.reason
          ),

        suggested_service:
          cleanString(
            req.body
              ?.suggestedService
          ),

        outreach_angle:
          cleanString(
            req.body
              ?.outreachAngle
          ),

        priority_score:
          priorityScore,

        status:
          getLeadStatus(
            priorityScore
          ),

        notes:
          "",
      };

      const {
        data,
        error,
      } =
        await supabase
          .from("leads")
          .insert(
            payload
          )
          .select("*")
          .single();

      if (error) {
        throw error;
      }

      return res
        .status(201)
        .json({
          success: true,

          lead:
            dbLeadToApi(data),
        });
    } catch (error) {
      console.error(
        "Save lead error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          error:
            "Failed to save lead.",
        });
    }
  }
);

// ============================================================
// LEADS — UPDATE OWN LEAD
// ============================================================

app.patch(
  "/api/leads/:id",
  requireAuth,
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error(
          "Database service is not configured."
        );
      }

      const id =
        cleanString(
          req.params?.id
        );

      if (!id) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Lead ID is required.",
          });
      }

      const updates = {
        updated_at:
          new Date().toISOString(),
      };

      if (
        typeof req.body?.notes ===
        "string"
      ) {
        updates.notes =
          req.body.notes.trim();
      }

      if (
        typeof req.body?.status ===
        "string"
      ) {
        const allowed = [
          "Hot",
          "Warm",
          "Cold",
          "Contacted",
          "Replied",
          "Won",
          "Lost",
        ];

        if (
          !allowed.includes(
            req.body.status
          )
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Invalid status.",
            });
        }

        updates.status =
          req.body.status;
      }

      const {
        data,
        error,
      } =
        await supabase
          .from("leads")
          .update(
            updates
          )
          .eq(
            "id",
            id
          )
          .eq(
            "user_id",
            req.user.id
          )
          .select("*")
          .single();

      if (error) {
        throw error;
      }

      return res.json({
        success: true,

        lead:
          dbLeadToApi(data),
      });
    } catch (error) {
      console.error(
        "Update lead error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          error:
            "Failed to update lead.",
        });
    }
  }
);

// ============================================================
// LEADS — DELETE OWN LEAD
// ============================================================

app.delete(
  "/api/leads/:id",
  requireAuth,
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error(
          "Database service is not configured."
        );
      }

      const id =
        cleanString(
          req.params?.id
        );

      if (!id) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Lead ID is required.",
          });
      }

      const {
        error,
      } =
        await supabase
          .from("leads")
          .delete()
          .eq(
            "id",
            id
          )
          .eq(
            "user_id",
            req.user.id
          );

      if (error) {
        throw error;
      }

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "Delete lead error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          error:
            "Failed to delete lead.",
        });
    }
  }
);

// ============================================================
// OUTREACH
// ============================================================

app.post(
  "/api/outreach",
  requireAuth,
  async (req, res) => {
    try {
      const lead =
        req.body?.lead ||
        {};

      const channel =
        cleanString(
          req.body?.channel,
          "Email"
        );

      const allowedChannels = [
        "Email",
        "WhatsApp",
        "LinkedIn",
      ];

      if (
        !allowedChannels.includes(
          channel
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Invalid outreach channel.",
          });
      }

      if (
        !cleanString(
          lead?.businessName
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Lead information is required.",
          });
      }

      const prompt = `
You are a professional B2B sales copywriter.

Write a personalized ${channel} outreach message.

BUSINESS:
${lead.businessName}

INDUSTRY:
${lead.industry || "Unknown"}

LOCATION:
${lead.location || "Unknown"}

WEBSITE:
${lead.website || "Unknown"}

LIKELY NEED:
${lead.likelyNeed || "Unknown"}

WHY THIS PROSPECT:
${lead.reason || "Unknown"}

SERVICE:
${lead.suggestedService || "Professional services"}

OUTREACH ANGLE:
${lead.outreachAngle || "Unknown"}

Rules:

- Never invent names.
- Never invent metrics.
- Never invent emails or phone numbers.
- Do not pretend unsupported facts are known.
- Treat likelyNeed as a hypothesis.
- Sound natural.
- Keep the first outreach concise.
- Focus on business value.
- Use one clear CTA.

If channel is Email:
Return Subject + Email.

If channel is WhatsApp:
Return only a concise WhatsApp message.

If channel is LinkedIn:
Return a short LinkedIn connection/follow-up message.
`;

      const text =
        await generateWithGemini(
          prompt
        );

      return res.json({
        success: true,

        channel,

        text,
      });
    } catch (error) {
      console.error(
        "Outreach error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          error:
            "Outreach generation failed.",
        });
    }
  }
);

// ============================================================
// 404
// ============================================================

app.use(
  (req, res) => {
    return res
      .status(404)
      .json({
        success: false,

        error:
          "Route not found.",

        path:
          req.originalUrl,
      });
  }
);

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "Unhandled server error:",
      error
    );

    if (
      res.headersSent
    ) {
      return next(error);
    }

    return res
      .status(500)
      .json({
        success: false,
        error:
          "Internal server error.",
      });
  }
);

// ============================================================
// START
// ============================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log(
      "================================="
    );
    console.log(
      "AI CLIENT HUNTER V6.2"
    );
    console.log(
      "================================="
    );

    console.log(
      `Server running on port ${PORT}`
    );

    console.log(
      `Allowed frontends:
${FRONTEND_URLS.join(", ")}`
    );

    console.log(
      `Gemini: ${
        GEMINI_API_KEY
          ? "CONNECTED"
          : "NOT CONFIGURED"
      }`
    );

    console.log(
      `Tavily: ${
        TAVILY_API_KEY
          ? "CONNECTED"
          : "NOT CONFIGURED"
      }`
    );

    console.log(
      `Supabase: ${
        supabase
          ? "CONNECTED"
          : "NOT CONFIGURED"
      }`
    );

    console.log(
      `Rate limit:
${RATE_LIMIT_MAX} requests /
${RATE_LIMIT_WINDOW_MS}ms`
    );

    console.log(
      `Model: ${GEMINI_MODEL}`
    );

    console.log(
      "================================="
    );
  }
);