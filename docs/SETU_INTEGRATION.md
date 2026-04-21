# Setu API Integration Plan

Ray currently uses Plaid for bank connectivity — a US-centric service. Setu is the Indian equivalent, built on RBI's Account Aggregator (AA) framework. This document outlines integrating Setu to make Ray work for Indian users.

---

## Why Setu?

| Feature | Plaid (current) | Setu (India) |
|---|---|---|
| Bank connectivity | US banks | Indian banks via AA framework |
| Transaction sync | ✅ | ✅ via AA consent flow |
| Account balances | ✅ | ✅ |
| Regulatory model | Open Banking | RBI Account Aggregator |
| Payment links | ❌ | ✅ UPI deeplinks |
| Bank verification | ❌ | ✅ Reverse penny drop |
| Cost | Paid | Freemium |

---

## Setu APIs to Integrate

### 1. Account Aggregator (AA) — Primary replacement for Plaid

The AA framework lets users share bank data with consent. Ray acts as an **FIU (Financial Information User)**.

**Flow:**
1. User initiates consent → Setu generates a consent request
2. User approves via their bank's AA app (e.g., CAMS FinServ, OneMoney)
3. Setu fetches FI data from the bank (FIP) on behalf of Ray
4. Ray receives a `FI_DATA_READY` webhook and stores transactions locally

**Key endpoints:**
```
POST /consents                     → Create consent request
GET  /consents/{id}                → Poll consent status
POST /sessions                     → Create data session after consent
GET  /sessions/{id}                → Poll session / get FI data
GET  /v2/fips                      → List supported banks (FIPs)
POST /v3/fiData                    → Push FI data for analysis (optional)
```

**Data received per account (INR, Indian banks):**
```json
{
  "type": "deposit",
  "summary": { "currentBalance": "101666.33", "currency": "INR", ... },
  "transactions": {
    "transaction": [
      { "amount": "1239", "mode": "UPI", "narration": "...", "type": "DEBIT", "valueDate": "2021-04-01" }
    ]
  }
}
```

**Supported FI types:** `DEPOSIT`, `MUTUAL_FUNDS`, `EQUITIES`, `ETF`, `TERM_DEPOSIT`, `RECURRING_DEPOSIT`, `SIP`, `INSURANCE_POLICIES`, `NPS`, `LOAN_ACCOUNTS`

---

### 2. UPI Deeplinks — Payment initiation (optional/future)

Lets Ray generate payment links for users to pay bills or transfer funds directly from the CLI.

**Key endpoints:**
```
POST /payment-links                → Create UPI payment link
GET  /payment-links/{id}          → Check payment status
```

**Example response:**
```json
{
  "data": {
    "paymentLink": {
      "shortURL": "https://bills.pe/Srmjne3",
      "upiID": "setu868062282@kaypay"
    },
    "platformBillID": "868062282653893900"
  }
}
```

---

### 3. Reverse Penny Drop — Bank account verification (optional)

Verify a user's bank account (name, IFSC, account number) before linking it manually.

```
POST /api/v1/banking/bav/reverse-penny-drop   → Create verification session
GET  /api/v1/banking/bav/reverse-penny-drop/{id}  → Check status
```

---

## Architecture Changes

### New files to create

```
src/
  setu/
    client.ts          ← Setu HTTP client (auth + base URL)
    aa.ts              ← Account Aggregator: consent, session, FI data fetch
    upi.ts             ← UPI deeplinks (future)
    types.ts           ← TypeScript types for Setu FI data
  plaid/               ← Keep existing (for US users)
```

### Config changes (`src/config.ts`)

Add to `RayConfig`:
```ts
setuClientId: string;
setuClientSecret: string;
setuEnv: string;           // "sandbox" | "production"
setuProductInstanceId: string;
```

And new env vars in `.env.example`:
```bash
SETU_CLIENT_ID=
SETU_CLIENT_SECRET=
SETU_ENV=sandbox
SETU_PRODUCT_INSTANCE_ID=
```

### DB schema changes (`src/db/schema.ts`)

The existing `accounts`, `transactions`, and `institutions` tables map cleanly to Setu data. Minor additions needed:

```sql
-- Add to accounts table
ALTER TABLE accounts ADD COLUMN source TEXT DEFAULT 'plaid';  -- 'plaid' | 'setu' | 'manual'
ALTER TABLE accounts ADD COLUMN currency TEXT DEFAULT 'USD';   -- 'INR' for Setu accounts

-- New table for AA consent tracking
CREATE TABLE IF NOT EXISTS setu_consents (
  consent_id TEXT PRIMARY KEY,
  consent_handle TEXT,
  status TEXT NOT NULL,          -- PENDING | APPROVED | REJECTED | EXPIRED | REVOKED
  fi_types TEXT NOT NULL,        -- JSON array of FI types requested
  date_range_from TEXT,
  date_range_to TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

-- New table for AA data sessions
CREATE TABLE IF NOT EXISTS setu_sessions (
  session_id TEXT PRIMARY KEY,
  consent_id TEXT NOT NULL REFERENCES setu_consents(consent_id),
  status TEXT NOT NULL,          -- PENDING | COMPLETED | FAILED | EXPIRED
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Sync flow (`src/setu/aa.ts`)

Mirror the Plaid sync pattern:

```ts
// 1. Create consent
export async function createConsent(db, fiTypes, dateRange): Promise<string>

// 2. Poll consent status (or use webhook)
export async function pollConsent(db, consentId): Promise<ConsentStatus>

// 3. Create data session after consent approved
export async function createSession(db, consentId): Promise<string>

// 4. Fetch FI data once session is ready
export async function fetchFIData(db, sessionId): Promise<void>

// 5. Parse + store transactions (maps INR Setu format → existing transactions table)
export async function ingestFIData(db, fiData): Promise<SyncResult>
```

### CLI changes (`src/cli/`)

- **`ray setup`** — detect region (India/US) or let user choose; show Setu setup path alongside Plaid
- **`ray link`** — if Setu configured, open AA consent URL instead of Plaid Link
- **`ray sync`** — detect which accounts are Setu-sourced and call `setu/aa.ts` sync

---

## Implementation Phases

### Phase 1 — Core AA integration
- [ ] `src/setu/client.ts` — authenticated HTTP client
- [ ] `src/setu/types.ts` — FI data types (deposit, equities, mutual fund)
- [ ] `src/setu/aa.ts` — consent creation, session management, FI data fetch
- [ ] DB schema migration (add `source` column, `setu_consents`, `setu_sessions` tables)
- [ ] `src/config.ts` — add Setu config fields
- [ ] `ray setup` — Setu credentials wizard step
- [ ] `ray link` — AA consent flow (opens browser or prints URL)
- [ ] `ray sync` — Setu sync path

### Phase 2 — Indian context improvements
- [ ] Map Indian transaction categories (UPI, NEFT, RTGS, IMPS, NACH) to Ray's category system
- [ ] Currency display: show ₹ for INR accounts
- [ ] Support MF, SIP, equities FI types (map to existing `holdings` table)
- [ ] `ray status` — show INR net worth correctly

### Phase 3 — Optional features
- [ ] UPI deeplinks (`ray pay`) — generate payment links from CLI
- [ ] Reverse penny drop for manual account verification
- [ ] Webhook server (`src/server.ts` already exists) — handle `FI_DATA_READY` push instead of polling

---

## Setu Auth

Setu uses **OAuth 2.0 client credentials**:

```http
POST https://auth.setu.co/auth/realms/setu/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<SETU_CLIENT_ID>
&client_secret=<SETU_CLIENT_SECRET>
```

All API calls then include:
```http
Authorization: Bearer <token>
X-Setu-Product-Instance-ID: <SETU_PRODUCT_INSTANCE_ID>
```

The client in `src/setu/client.ts` should handle token caching and refresh automatically (similar to how `src/plaid/client.ts` wraps Plaid).

---

## Getting Setu Credentials

1. Sign up at [setu.co](https://setu.co)
2. Create an app in the Setu Dashboard
3. Enable **Account Aggregator (FIU)** product
4. Get: Client ID, Client Secret, Product Instance ID
5. Use `sandbox` environment for development (free, no real bank data)

Sandbox test FIP: `setu-fip` (Setu's mock bank for testing)

---

## References

- [Setu AA Quickstart](https://docs.setu.co/data/account-aggregator/quickstart)
- [Consent Object Docs](https://docs.setu.co/data/account-aggregator/consent-object)
- [FI Data Types](https://docs.setu.co/data/account-aggregator/fi-data-types)
- [UPI Deeplinks](https://docs.setu.co/payments/upi-deeplinks/quickstart)
- [Reverse Penny Drop](https://docs.setu.co/data/bav/reverse-penny-drop)
