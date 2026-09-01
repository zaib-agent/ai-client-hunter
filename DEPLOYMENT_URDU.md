# AI CLIENT HUNTER V6
# Production Deployment — Urdu Guide

---

## PART 1 — LOCAL PROJECT CHECK

Project folder:

C:\Users\OWAISI\Desktop\AI Client Hunter

PowerShell mein:

cd "C:\Users\OWAISI\Desktop\AI Client Hunter"

---

## PART 2 — INSTALL DEPENDENCIES

Run:

npm ci

Agar npm.ps1 execution policy error aaye:

Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

Phir:

npm ci

---

## PART 3 — FRONTEND BUILD

Run:

npm run build

Agar:

dist

folder create ho jaye aur build successful aaye,
to frontend production build ready hai.

---

## PART 4 — SUPABASE DATABASE

Supabase dashboard open karein.

SQL Editor open karein.

File:

supabase-production.sql

ka COMPLETE code paste karein.

Run karein.

End par:

AI Client Hunter production database ready

show hona chahiye.

---

## PART 5 — SUPABASE AUTH

Supabase:

Authentication
→ URL Configuration

Production frontend URL ko:

Site URL

mein set karein.

Example:

https://your-frontend-domain.com

Redirect URLs mein add karein:

https://your-frontend-domain.com

Aur agar authentication callback route use ho:

https://your-frontend-domain.com/**

Local development ke liye:

http://localhost:5173

bhi add kiya ja sakta hai.

---

## PART 6 — FRONTEND ENVIRONMENT

Local development ke liye:

.env

mein:

VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co

VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY

VITE_API_URL=http://localhost:5000

VITE_AUTH_REDIRECT_URL=http://localhost:5173

Production mein localhost use NA karein.

Production example:

VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co

VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY

VITE_API_URL=https://YOUR-BACKEND.onrender.com

VITE_AUTH_REDIRECT_URL=https://YOUR-FRONTEND-DOMAIN.com

---

## PART 7 — BACKEND ENVIRONMENT

Backend mein:

GEMINI_API_KEY=REAL_GEMINI_KEY

GEMINI_MODEL=gemini-3.6-flash

TAVILY_API_KEY=REAL_TAVILY_KEY

SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co

SUPABASE_SERVICE_ROLE_KEY=REAL_SERVER_SIDE_KEY

FRONTEND_URL=https://YOUR-FRONTEND-DOMAIN.com

NODE_ENV=production

PORT=5000

RATE_LIMIT_MAX=100

RATE_LIMIT_WINDOW_MS=900000

---

## PART 8 — IMPORTANT SECURITY RULE

Kabhi bhi ye values frontend code mein expose na karein:

GEMINI_API_KEY

TAVILY_API_KEY

SUPABASE_SERVICE_ROLE_KEY

Ye sirf backend environment variables hain.

Frontend sirf:

VITE_SUPABASE_URL

VITE_SUPABASE_ANON_KEY

VITE_API_URL

use kare.

---

## PART 9 — GITHUB

Project root mein:

git status

Phir:

git add .

Phir:

git commit -m "Production authentication and deployment"

Phir:

git push origin main

Agar remote changes ki wajah se rejection aaye:

git pull --rebase origin main

Phir:

git push origin main

---

## PART 10 — RENDER BACKEND

Render open karein.

New Web Service.

GitHub repository:

ai-client-hunter

select karein.

Render automatically render.yaml read kar sakta hai.

Build Command:

npm ci

Start Command:

npm run server

Health Check:

/health

---

## PART 11 — RENDER VARIABLES

Render Environment Variables mein:

GEMINI_API_KEY

TAVILY_API_KEY

SUPABASE_URL

SUPABASE_SERVICE_ROLE_KEY

FRONTEND_URL

add karein.

Frontend URL deploy hone ke baad exact production URL set karein.

Example:

https://ai-client-hunter-frontend.onrender.com

---

## PART 12 — BACKEND TEST

Browser mein:

https://YOUR-BACKEND.onrender.com/health

open karein.

Expected:

success = true

services:

gemini = true

tavily = true

supabase = true

---

## PART 13 — FRONTEND DEPLOYMENT

Frontend ko Vercel / Render Static Site / Netlify par deploy karein.

Build command:

npm run build

Output directory:

dist

---

## PART 14 — FRONTEND ENVIRONMENT

Production frontend environment:

VITE_API_URL=https://YOUR-BACKEND.onrender.com

VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co

VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY

VITE_AUTH_REDIRECT_URL=https://YOUR-FRONTEND-DOMAIN.com

---

## PART 15 — SUPABASE REDIRECT

Supabase:

Authentication
→ URL Configuration

Site URL:

https://YOUR-FRONTEND-DOMAIN.com

Redirect URLs:

https://YOUR-FRONTEND-DOMAIN.com/**

Local:

http://localhost:5173/**

---

## PART 16 — FINAL TEST

Production website open karein.

Test:

1. Signup
2. Confirmation email
3. Email confirmation
4. Browser production URL open
5. Login
6. Logout
7. Login again
8. Search clients
9. Save lead
10. Refresh
11. Lead remains
12. Logout
13. Login with another account
14. Previous user's leads should NOT appear

---

## PART 17 — SECURITY TEST

Confirm:

User A cannot see User B leads.

Backend API requires:

Authorization: Bearer SUPABASE_ACCESS_TOKEN

Service role key is never sent to frontend.

CORS only allows production frontend.

Secrets are not committed to GitHub.

.env is ignored by Git.

---

## FINAL ARCHITECTURE

Frontend:

Browser
↓
Production HTTPS Frontend
↓
Supabase Auth

and

Frontend
↓
HTTPS Backend
↓
Gemini
↓
Tavily
↓
Supabase

---

## LOCAL DEVELOPMENT

Frontend:

http://localhost:5173

Backend:

http://localhost:5000

Run:

npm run dev:full

---

## PRODUCTION

Frontend:

HTTPS production URL

Backend:

HTTPS Render URL

Supabase:

HTTPS project URL

Never use:

http://192.168.x.x

for production authentication.

Never use:

localhost

inside production VITE_API_URL.

---