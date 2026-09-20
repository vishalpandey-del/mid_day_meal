# Deploying to Vercel

The API and the site are two separate Vercel projects from one repository.

| Project | Root directory | URL |
|---|---|---|
| Backend | `server` | https://mid-day-meal-ze1a.vercel.app |
| Frontend | `client` | https://mid-day-meal-beta.vercel.app |

---

## 1. Backend project

**Settings → General → Root Directory:** `server`

**Settings → Environment Variables** (add to Production, Preview and Development):

| Name | Value |
|---|---|
| `MONGO_URI` | `mongodb+srv://USER:PASS@mid1.unje2ag.mongodb.net/vidyaposhan?retryWrites=true&w=majority` |
| `JWT_SECRET` | a long random string — **not** the local one |
| `JWT_EXPIRES_IN` | `8h` |
| `CLIENT_URL` | `https://mid-day-meal-beta.vercel.app` |
| `NODE_ENV` | `production` |
| `MAX_UPLOAD_MB` | `10` |

`CLIENT_URL` accepts several origins separated by commas, so a custom domain
can be added later without a code change. Any `*.vercel.app` preview URL is
accepted automatically.

To generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**Atlas → Network Access** must allow `0.0.0.0/0`. Vercel functions do not run
from fixed addresses, so an IP allow-list cannot work.

Redeploy after saving the variables — Vercel bakes them in at build time.

Check it:

```
https://mid-day-meal-ze1a.vercel.app/api/health
→ {"success":true,"service":"Vidyaposhan API","status":"ok",...}
```

---

## 2. Frontend project

**Settings → General → Root Directory:** `client`

**Environment variables: none required.**

`src/api/client.js` falls back to the deployed API for any production build,
so the site works straight after a deploy.

To point the site at a different backend, set `VITE_API_URL` (no trailing
slash — the client appends `/api`). It is read at **build** time, so the
project must be redeployed after adding it; restarting is not enough.

---

## 3. Seed the database once

Vercel will not do this for you. Run it from your own machine, pointing at the
same Atlas database the deployment uses:

```bash
cd server
npm run db:check      # confirm the connection and see what is there
npm run seed:fresh    # WARNING: deletes everything first
```

---

## How the pieces fit

**`server/api/index.js`** is the serverless entry. It caches the Mongo
connection on the module scope, because a function is frozen between
invocations rather than shut down; without the cache every request would open a
new pool and Atlas would start refusing connections.

**`server/vercel.json`** rewrites every path to that function, so Express keeps
its own routing.

**`client/vercel.json`** rewrites every path to `index.html`, so a deep link
such as `/login` is handled by the router instead of returning 404.

`src/server.js` is still the local entry point and is unused in production.

---

## Known limits

**Region.** `server/vercel.json` pins the function to `bom1` (Mumbai) because
the Atlas cluster is there. Left to its default the function ran in
Washington, and every query crossed the Atlantic — around 1.1 seconds of
waiting per dashboard load. Keep the two in the same region; if the cluster
moves, change `regions` to match.

**Cold starts.** The first request after a quiet period waits for the function
to boot and the database handshake — a few seconds. Subsequent requests are
fast.

**Upload size.** Vercel rejects a request body over 4.5 MB before it reaches
the function, and it returns no JSON, so the browser reports a bare network
error. The upload cap therefore drops to 4 MB when `VERCEL` is set, and
`GET /api/limits` tells the client what it is so an oversized file is refused
with a readable message instead. Running anywhere else keeps the 10 MB
default.

**Upload storage.** Bill documents are stored as bytes in MongoDB, because a
serverless filesystem is wiped between invocations. This needs no extra
service and the files are covered by the Atlas backup, but a single document
cannot exceed 16 MB and the free tier holds 512 MB in total. At a few hundred
bills that is comfortable; past that, move `middleware/upload.js` to object
storage (S3, Cloudinary or Vercel Blob) and keep only the URL on the claim.
The read path already falls back to disk, so old local files keep working.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `404 NOT_FOUND` on the API | Root Directory is not `server`, or `vercel.json` is missing |
| `503 Database unavailable` | `MONGO_URI` wrong, or Atlas is not allowing `0.0.0.0/0` |
| Login works locally, fails when deployed | `VITE_API_URL` missing, or set after the last build |
| CORS error in the browser console | `CLIENT_URL` does not match the site's origin |
| `404` on `/login` but `/` works | Frontend `vercel.json` rewrite is missing |
| `401` immediately after signing in | `JWT_SECRET` changed between deployments |
| "Network error" when creating a bill | File over 4.5 MB — Vercel drops it before the function sees it |
