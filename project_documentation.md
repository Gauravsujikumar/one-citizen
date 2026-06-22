# OneCitizen AI — Comprehensive Technical Documentation & System Specification

OneCitizen AI is an advanced citizen digital twin and copilot portal designed to simplify, secure, and accelerate government service applications (e.g., MeeSeva certificates in Telangana). It uses artificial intelligence to prevent document mismatch rejections, auto-fill complex forms, and guide citizens through bureaucratic processes.

---

## 1. Executive Summary

Applying for government services in India often involves high rejection rates, accessibility challenges, and confusion over required documents. OneCitizen AI solves these problems through:
- **Rejection Prevention via "Readiness Scoring":** Fuzzy-matching names across documents and checking validity rules before citizen submission.
- **The Citizen Digital Twin:** Securing credentials in a digital vault and auto-filling official forms.
- **AI-Powered Bureaucracy Copilot:** A chat assistant explaining welfare schemes and recommending certificates.
- **Inclusive Accessibility:** Multi-language support (English, Telugu, Hindi, Urdu) with a clean user experience.

---

## 2. System Architecture & Infrastructure

OneCitizen AI uses a dual-mode system architecture designed to run on serverless environments (e.g. Vercel) while maintaining full offline-first capabilities for local development.

```
       [ Citizen Portal (SPA) ]               [ Officer Portal ]
                  |                                   |
                  +-----------------+-----------------+
                                    | (JSON over HTTPS / SSE)
                                    v
                          [ Node.js/Express API ]
                                    |
            +-----------------------+-----------------------+
            | (Dual-Mode Data Layer fallback checks)        |
            v                                               v
  [ SQLite (Local Dev) ]                            [ Google Firestore ]
  File: backend/one_citizen.db                      Database: cloud-managed
```

### Technology Stack Details:
- **Frontend:** Vanilla HTML5, CSS3 variables (design tokens, dark themes), and ES6+ asynchronous JavaScript.
- **Map Visualizations:** Leaflet.js mapping regional MeeSeva centers.
- **Backend API:** Node.js Express server.
- **Authentication:** Firebase Auth compatibility layer and mobile OTP routing.
- **AI Engine:** Gemini 2.0 Flash API (Vision OCR and chat prompts).

---

## 3. Citizen Digital Twin Portal Features

The citizen portal is structured as a Single Page Application (SPA) with a dynamic state engine:
- **Digital Twin Vault:** Ingests document uploads, validates credentials, and pre-populates forms.
- **AI Bureaucracy Copilot:** Conversational interface suggesting schemes and launching pre-filled forms.
- **MeeSeva Locator:** Fully interactive local maps using Leaflet.js coordinates.
- **Multi-Language Switcher:** Translations dictionary in `app.js` enabling hot-swapping between English, Telugu, Hindi, and Urdu.

---

## 4. Document Ingestion & OCR Processing Pipeline

The ingestion pipeline checks document integrity at upload:

1. **Multer Upload:** Files are uploaded to the backend and saved to `uploads/`.
2. **Tier 1 (Gemini Vision OCR):** The backend queries the `gemini-2.0-flash` model with the base64-encoded image and a structured JSON output prompt:
   ```json
   {
     "document_type": "aadhaar" | "pan" | "other",
     "name": "Extracted Name",
     "dob": "DD/MM/YYYY",
     "id_number": "XXXX-XXXX-XXXX",
     "is_legible": true | false
   }
   ```
3. **Tier 2 (Tesseract.js Fallback):** If the API is offline, the server launches a local `tesseract.js` worker using English/Telugu language data, running regular expressions to parse identifiers:
   - Aadhaar: `[0-9]{4}\s[0-9]{4}\s[0-9]{4}`
   - PAN: `[A-Z]{5}[0-9]{4}[A-Z]{1}`

---

## 5. Fuzzy Verification & Readiness Scoring Algorithms

To prevent rejections, fuzzy comparisons are run before submission:

### Fuzzy Name-Matching
The Levenshtein Distance ($d$) between normalized names is computed. The similarity percentage ($S$) is calculated as:
$$S(A, B) = \left(1 - \frac{d(A, B)}{\max(\text{len}(A), \text{len}(B))}\right) \times 100$$
Acceptance occurs at $S \ge 80\%$.

### Readiness Score
The pre-submission score ($R$) aggregates matching metrics:
$$R = 0.40 \cdot S_{aadhaar} + 0.30 \cdot F_{docs} \cdot 100 + 0.30 \cdot \text{Validity}$$
If $R < 80\%$, submission is blocked, and discrepancies are flagged to the citizen.

---

## 6. Officer Verification Portal Operations

Designed for government administrators, this interface manages verification queues:
- **Work Queue Dashboard:** Real-time table using professional outline SVGs.
- **SSE Live Pipeline:** An active Server-Sent Events line (`/api/admin/applications/live`) pushes citizen submissions instantly to the dashboard.
- **Bulk Verification:** Runs background evaluations, marking high-readiness files for bulk approval.
- **Mandatory Rejection Reasons:** Requiring input notes when rejecting, maintaining transparency.

---

## 7. Backend API Endpoint Reference

- **POST /api/auth/register:** Self-registration (hashes passwords; role: citizen).
- **POST /api/auth/login:** Validates credentials and returns JWT.
- **POST /api/otp/send:** Dispatches a 6-digit OTP code (implements rate-limiting).
- **POST /api/otp/verify:** Verifies mobile OTP and issues a JWT token.
- **POST /api/documents/upload:** Ingests document, runs Gemini OCR, and stores metadata.
- **GET /api/admin/applications:** Lists submissions.
- **PATCH /api/admin/applications/:id/status:** Updates status and posts notifications.

---

## 8. Relational Database Schema Design

### Table: users
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  password_hash TEXT,
  role TEXT DEFAULT 'citizen',
  mobile TEXT UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### Table: citizen_profiles
```sql
CREATE TABLE citizen_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  name TEXT DEFAULT '',
  dob TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  occupation TEXT DEFAULT '',
  income_amount REAL DEFAULT 0,
  state TEXT DEFAULT '',
  district TEXT DEFAULT '',
  caste TEXT DEFAULT '',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### Table: documents
```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  document_type TEXT,
  file_path TEXT,
  extracted_name TEXT,
  extracted_id_number TEXT,
  is_verified INTEGER DEFAULT 0,
  validation_status TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

## 9. System Security Architecture & Controls

- **CORS Configuration:** Capped to allowed origins to block cross-origin requests.
- **Payload Restrictions:** Maximum JSON parser limit set to `1mb` to prevent memory flooding.
- **Privilege Separation:** Users registering self-default to `'citizen'`. Promotion to `'admin'` is only done through backend databases.
- **SQL Injection Defense:** All queries parameterized using `$1`, `$2` binds.
- **XSS Mitigation:** Frontend sanitizes strings via `escapeHTML` character encoding.

---

## 10. Deployment & Operations Guide

### Local Installation
1. Install dependencies:
   ```bash
   npm install
   ```
2. Reset and seed database:
   ```bash
   node backend/update_seed_run.js
   ```
3. Run development backend:
   ```bash
   npm run dev
   ```

### Production Deployment
Automatic rebuilds are configured for Vercel on pushes to the `main` branch. Ensure `DATABASE_URL` is set in Vercel settings to target production cloud storage.
