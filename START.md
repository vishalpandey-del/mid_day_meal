# Vidyaposhan — Test Drive

## Pehli baar (ek hi baar karna hai)

```bash
cd server && npm install
cd ../client && npm install
```

MongoDB chahiye. Do rastey:

- **Local MongoDB** — `server/.env` mein pehle se set hai:
  `MONGO_URI=mongodb://127.0.0.1:27017/vidyaposhan`
- **Atlas** — `cd server && npm run db:set` chalao, username/password daalo.

---

## Chalane ke liye (do terminal)

**Terminal 1 — Backend**
```bash
cd server
npm run db:check      # dekho DB mein kya hai (seed se pehle)
npm run seed:fresh    # demo data daalo (purana DELETE hoga)
npm run dev           # http://localhost:5000
```

**Terminal 2 — Frontend**
```bash
cd client
npm run dev           # http://localhost:5173
```

Browser: **http://localhost:5173**

---

## Test Logins

| Role | User ID | Password | Kya dikhega |
|---|---|---|---|
| Admin | `ADMIN001` | `Admin@123` | Master upload, login manager, users, transfer |
| State / SSA | `STATE001` | `State@123` | Poora state, pie charts, budget → DC |
| District (DC) | `DC1801` | `Dc@123` | Approve/reject/query, bulk approve, payments |
| Block | `BLK180101` | `Block@123` | Sirf remark — forward ya return |
| School Maker | `MKR18140100` | `School@123` | Bill banana |
| School Checker | `CHK18140100` | `School@123` | Sirf remark — forward ya return |

---

## Ghumne ka sujhaav (isi kram mein)

### 1. School Maker (`MKR18140100`)
- **New Bill** → form teen hisson mein: vendor A/C + IFSC pehle, phir scheme, phir bill
- Submit karo → status **"Pending Checker Review"**

### 2. School Checker (`CHK18140100`)
- **My Queue** → wahi bill dikhega
- Kholo → sirf **Forward** aur **Return** ke button (approve nahi)
- Forward karo remark ke saath

### 3. Block (`BLK180101`)
- **My Queue** → ab bill yahan
- Forward karo → status **"Submitted"**, SLA ghadi ab shuru

### 4. District (`DC1801`)
- **My Queue** → checkbox se kai bill chuno → **Approve Selected** (bulk)
- Ya ek bill kholo → Approve / Query / Reject
- **Payments** → Mark Paid, aur **Download PFMS File**
- PFMS download ke baad us bill ka status badalne jao → **remark maangega**

### 5. State (`STATE001`)
- **Dashboard** → teen pie chart (status, scheme, paid/unpaid)
- **Budget** → kisi district ko paisa do

### 6. Admin (`ADMIN001`)
- **Master Upload** → Template download karo, bharo, Preview → Import
- **Login Manager** → naye schools ke liye login banao, password CSV download
- **Users & Transfers** → kisi block officer ko doosre block mein Transfer karo,
  phir us login se dekho — nayi jagah dikhegi, purani nahi

---

## Dhyan dene layak

- **Checker aur Block approve nahi kar sakte** — sirf remark. Button hi nahi dikhega.
- **Paid/Unpaid sirf DC** ke paas.
- **PFMS file mein sirf Approved bill** jaate hain.
- **Export ke baad status badla** → 5+ character ka remark zaroori.
- **Budget warning deta hai, rokta nahi** — over-budget bill ban jayega.
- **Transfer** ke baad login ID wahi rehti hai, sirf jagah badalti hai.

---

## Dikkat aaye toh

**Port busy:**
```bash
npx kill-port 5000 5173
```

**Login 429 (Too Many Requests):** 15 minute mein 10 login ki limit hai.
Backend restart karo — limit reset ho jayegi.

**"No data" dikhe:** `npm run seed:fresh` chalaya tha? `npm run db:check` se confirm karo.
