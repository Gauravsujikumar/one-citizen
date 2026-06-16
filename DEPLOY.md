# OneCitizen AI — Vercel Deployment Guide

## ⚠️ Important: Database Setup First

Vercel is serverless — **SQLite won't work** because there's no persistent disk. You need a cloud PostgreSQL database.

### Free PostgreSQL Options:
| Provider | Free Tier | Setup |
|----------|-----------|-------|
| **Vercel Postgres** | 256MB free | Dashboard → Storage → Create Database |
| **Neon** | 512MB free | [neon.tech](https://neon.tech) → Create Project |
| **Supabase** | 500MB free | [supabase.com](https://supabase.com) → New Project |

Once you have a PostgreSQL URL like:
```
postgresql://username:password@host:5432/dbname
```

---

## Step 1: Install Vercel CLI

```powershell
npm install -g vercel
```

## Step 2: Login to Vercel

```powershell
vercel login
```

## Step 3: Deploy Citizen App

From the project root (`d:\projects\one citizen`):

```powershell
cd "d:\projects\one citizen"
vercel --yes
```

When prompted:
- **Project name**: `onecitizen-app`
- **Framework**: `Other`
- **Root directory**: `.` (current)

### Set Environment Variables:

```powershell
vercel env add DATABASE_URL
```
Paste your PostgreSQL connection string.

```powershell
vercel env add DATABASE_SSL
```
Enter: `true`

```powershell
vercel env add JWT_SECRET
```
Enter any strong secret string (e.g., `onecitizen-jwt-secret-2026`)

### Deploy to Production:

```powershell
vercel --prod
```

This gives you: **https://onecitizen-app.vercel.app**

---

## Step 4: Deploy Officer Portal (Separate Link)

```powershell
cd "d:\projects\one citizen"
copy vercel-officer.json vercel.json
vercel --yes
```

When prompted:
- **Project name**: `onecitizen-officer`
- Set same environment variables as above

```powershell
vercel env add DATABASE_URL
vercel env add DATABASE_SSL  
vercel env add JWT_SECRET
vercel --prod
```

This gives you: **https://onecitizen-officer.vercel.app**

Then restore the citizen config:
```powershell
copy vercel.json vercel-citizen.json
```

---

## Step 5: Initialize Database Tables

After first deploy, open your PostgreSQL dashboard and run the schema from `backend/schema.sql`:

```sql
-- Copy the contents of backend/schema.sql and run it in your DB console
```

---

## Result

| App | URL |
|-----|-----|
| **Citizen App** | `https://onecitizen-app.vercel.app` |
| **Officer Portal** | `https://onecitizen-officer.vercel.app` |

Both share the same database, so officer actions (approve/reject) instantly reflect in the citizen app.

---

## Quick Alternative: Deploy Both from GitHub

1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com) → **Import Project**
3. Select your repo
4. Deploy twice with different `vercel.json` configs

