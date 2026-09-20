# Vidyaposhan — SSA Assam Bill Claim Portal

A bill-claim management portal for Samagra Shiksha Assam. Schools raise bills
against scheme budgets, the claim travels up a review chain, and the District
office approves and pays.

---

## The review chain

```
School Maker  →  School Checker  →  Block Office  →  District (DC)
  creates          remark only        remark only      approves / rejects
  the bill         forward/return     forward/return   and pays
```

Only the DC decides a claim. The checker and the block may record a remark and
either forward the claim on or return it to the maker for correction — they
cannot edit, approve, reject or query it.

### Roles

| Role | Scope | What it does |
|---|---|---|
| `school_maker` | One school | Raises and edits bills |
| `school_checker` | One school | Reviews, forwards or returns |
| `block` | One block | Reviews, forwards or returns |
| `dc` | One district | Approves, rejects, queries, pays |
| `state` | State-wide | Oversight, budget to districts, audit |
| `admin` | Platform | Master upload, logins, transfers |

Every list is narrowed to the caller's scope, so a block only ever sees its own
schools and a district only its own blocks.

---

## Getting started

### 1. Install

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Point at a database

`server/.env` is not in the repository. Copy the template and fill it in:

```bash
cd server
cp .env.example .env
```

For MongoDB Atlas, the helper writes the connection string for you and
URL-encodes the password (special characters in a password are the usual cause
of a `bad auth` error):

```bash
npm run db:set     # prompts for cluster, username, password
npm run db:check   # confirms the connection and shows what is already there
```

### 3. Seed and run

```bash
cd server
npm run seed:fresh   # demo data — this DELETES anything already in the database
npm run dev          # http://localhost:5000
```

```bash
cd client
npm run dev          # http://localhost:5173
```

### Demo logins

| Role | User ID | Password |
|---|---|---|
| Admin | `ADMIN001` | `Admin@123` |
| State / SSA | `STATE001` | `State@123` |
| District | `DC1801` | `Dc@123` |
| Block | `BLK180101` | `Block@123` |
| School Maker | `MKR18140100` | `School@123` |
| School Checker | `CHK18140100` | `School@123` |

---

## How the main pieces work

### Master data drives everything

The admin uploads the SSA school master sheet. The government ids already in
that sheet — `district_id`, `block_id`, `school_code` — build the whole
District → Block → School hierarchy, so no one has to invent identifiers.
Re-uploading an updated sheet updates rows in place instead of duplicating them.

Login ids follow the same ids (`DC1801`, `BLK180101`, `MKR18140100`), which
keeps them stable even when a school is renamed.

### Payments

An approved bill sits in one of three states:

- **Unpaid** — approved, never paid out
- **Paid** — settled, with a payment reference
- **Payment Reversed** — money went out and came back (closed account, wrong
  IFSC, treasury rejection). Reversing requires a written reason, and the bill
  returns to the PFMS file so it gets paid again.

Only the district office can set payment status.

### The PFMS beneficiary file

Only approved bills ever reach this file, and the beneficiary is always the
school. Each exported bill is stamped; from that point, changing its status
requires an explicit remark, which is recorded separately in the audit trail.

### Budget

Funds flow State → District → School. A school's page shows a running ledger —
the balance before each bill, the amount drawn, and the balance after — so it is
clear where an allocation went.

Going over budget produces a warning but never blocks a bill.

---

## Layout

```
server/
  src/
    config/        roles, claim statuses, validation schemas
    controllers/   request handlers
    models/        Mongoose schemas
    routes/        Express routers
    services/      master import, provisioning, budget, Excel, notifications
    middleware/    auth, validation, uploads, errors
    seed/          demo data and database helpers
client/
  src/
    pages/         one file per screen
    layouts/       app shell and role-aware navigation
    components/    shared UI primitives
    api/           axios client
```

---

## Scripts

| Command | Runs in | What it does |
|---|---|---|
| `npm run dev` | server | API with auto-reload |
| `npm start` | server | API |
| `npm run seed:fresh` | server | Load demo data (destructive) |
| `npm run db:check` | server | Test the connection, list what exists |
| `npm run db:set` | server | Write the Atlas string into `.env` |
| `npm run dev` | client | Vite dev server, proxied to the API |
| `npm run build` | client | Production build |

---

## Notes

- `server/.env` holds real credentials and is git-ignored. Only
  `.env.example` is committed.
- Set a long random `JWT_SECRET` before deploying.
- SMS and email are logged to the console; wire a real gateway into
  `services/notificationService.js` for production.
- Uploaded bill documents are written to `server/uploads/` and are not
  committed.
