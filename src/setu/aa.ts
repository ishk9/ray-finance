import type BetterSqlite3 from "libsql";
type Database = BetterSqlite3.Database;

import { setuGet, setuPost } from "./client.js";
import type {
  SetuConsentRequest,
  SetuConsentResponse,
  SetuConsentStatus,
  SetuSessionRequest,
  SetuSessionResponse,
  SetuSessionStatus,
  SetuFIDataResponse,
  SetuFIPData,
  SetuDepositAccount,
  SetuMutualFundAccount,
  SetuEquityAccount,
  SetuTransaction,
  SetuSyncResult,
} from "./types.js";
import { categoryFromSetuMode } from "./categories.js";

// ─── Consent ──────────────────────────────────────────────────────────────────

/**
 * Create a consent request and store it in the DB.
 * Returns the consent ID and the Setu URL the user must visit to approve.
 */
export async function createConsent(
  db: Database,
  vua: string,
  redirectUrl: string,
  options: {
    dataRangeMonths?: number;
    consentDurationMonths?: number;
    fiTypes?: string[];
  } = {}
): Promise<{ consentId: string; url: string }> {
  const {
    dataRangeMonths = 12,
    consentDurationMonths = 4,
    fiTypes = ["DEPOSIT", "MUTUAL_FUNDS", "EQUITIES"],
  } = options;

  const now = new Date();
  const from = new Date(now.getTime() - dataRangeMonths * 30 * 24 * 60 * 60 * 1000);

  const payload: SetuConsentRequest = {
    consentDuration: {
      unit: "MONTH",
      value: String(consentDurationMonths),
    },
    vua,
    dataRange: {
      from: from.toISOString(),
      to: now.toISOString(),
    },
    redirectUrl,
    context: [],
  };

  const resp = await setuPost<SetuConsentResponse>("/v2/consents", payload);

  const consentId = resp.id;
  const dateFrom = from.toISOString();
  const dateTo = now.toISOString();
  const expiresAt = resp.detail?.consentExpiry ?? null;

  db.prepare(`
    INSERT INTO setu_consents (consent_id, status, fi_types, date_range_from, date_range_to, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(consent_id) DO UPDATE SET status = excluded.status
  `).run(consentId, "PENDING", JSON.stringify(fiTypes), dateFrom, dateTo, expiresAt);

  return { consentId, url: resp.url };
}

/**
 * Poll Setu for the current consent status and update DB.
 */
export async function getConsentStatus(
  db: Database,
  consentId: string
): Promise<SetuConsentStatus> {
  const resp = await setuGet<SetuConsentResponse>(`/v2/consents/${consentId}`);

  db.prepare(`UPDATE setu_consents SET status = ? WHERE consent_id = ?`).run(
    resp.status,
    consentId
  );

  return resp.status;
}

// ─── Data Session ─────────────────────────────────────────────────────────────

/**
 * Create a data session after consent is APPROVED.
 * Returns the session ID.
 */
export async function createSession(
  db: Database,
  consentId: string
): Promise<string> {
  const consent = db
    .prepare(`SELECT date_range_from, date_range_to FROM setu_consents WHERE consent_id = ?`)
    .get(consentId) as { date_range_from: string; date_range_to: string } | undefined;

  if (!consent) throw new Error(`Consent ${consentId} not found in DB`);

  const payload: SetuSessionRequest = {
    consentId,
    dataRange: {
      from: consent.date_range_from,
      to: consent.date_range_to,
    },
    format: "json",
  };

  const resp = await setuPost<SetuSessionResponse>("/v2/sessions", payload);
  const sessionId = resp.id;

  db.prepare(`
    INSERT INTO setu_sessions (session_id, consent_id, status)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET status = excluded.status
  `).run(sessionId, consentId, resp.status ?? "PENDING");

  return sessionId;
}

/**
 * Poll Setu for the current data session status and update DB.
 */
export async function getSessionStatus(
  db: Database,
  sessionId: string
): Promise<SetuSessionStatus> {
  const resp = await setuGet<SetuSessionResponse>(`/v2/sessions/${sessionId}`);

  db.prepare(`UPDATE setu_sessions SET status = ? WHERE session_id = ?`).run(
    resp.status,
    sessionId
  );

  return resp.status;
}

/**
 * Poll until session is COMPLETED/PARTIAL/FAILED/EXPIRED.
 * Resolves with the final status.
 */
export async function pollSessionUntilReady(
  db: Database,
  sessionId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<SetuSessionStatus> {
  const { intervalMs = 4000, timeoutMs = 5 * 60 * 1000 } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await getSessionStatus(db, sessionId);
    if (status === "COMPLETED" || status === "PARTIAL") return status;
    if (status === "FAILED" || status === "EXPIRED") return status;
    await sleep(intervalMs);
  }

  throw new Error(`Session ${sessionId} did not complete within ${timeoutMs / 1000}s`);
}

// ─── Fetch + Ingest FI Data ───────────────────────────────────────────────────

/**
 * Fetch FI data for a session and store in the local DB.
 */
export async function fetchAndIngestFIData(
  db: Database,
  sessionId: string
): Promise<SetuSyncResult> {
  const resp = await setuGet<SetuFIDataResponse>(`/v2/sessions/${sessionId}`);

  const result: SetuSyncResult = {
    accountsLinked: 0,
    transactionsAdded: 0,
    holdingsUpdated: 0,
  };

  for (const fip of resp.fiData ?? []) {
    const fipResult = await ingestFIPData(db, fip);
    result.accountsLinked += fipResult.accountsLinked;
    result.transactionsAdded += fipResult.transactionsAdded;
    result.holdingsUpdated += fipResult.holdingsUpdated;
  }

  db.prepare(`UPDATE setu_sessions SET status = 'COMPLETED' WHERE session_id = ?`).run(sessionId);

  return result;
}

async function ingestFIPData(
  db: Database,
  fip: SetuFIPData
): Promise<SetuSyncResult> {
  const result: SetuSyncResult = {
    accountsLinked: 0,
    transactionsAdded: 0,
    holdingsUpdated: 0,
  };

  for (const entry of fip.data) {
    const account = entry.decryptedFI.account;

    if (account.type === "deposit") {
      const r = ingestDepositAccount(db, fip.fipID, entry.linkRefNumber, account as SetuDepositAccount);
      result.accountsLinked++;
      result.transactionsAdded += r.transactionsAdded;
    } else if (account.type === "mutual_fund") {
      ingestMutualFundAccount(db, fip.fipID, entry.linkRefNumber, account as SetuMutualFundAccount);
      result.accountsLinked++;
      result.holdingsUpdated++;
    } else if (account.type === "equities") {
      ingestEquityAccount(db, fip.fipID, entry.linkRefNumber, account as SetuEquityAccount);
      result.accountsLinked++;
      result.holdingsUpdated++;
    }
  }

  return result;
}

// ─── Deposit (savings / current) ─────────────────────────────────────────────

function ingestDepositAccount(
  db: Database,
  fipId: string,
  linkRefNumber: string,
  account: SetuDepositAccount
): { transactionsAdded: number } {
  const accountId = `setu-${linkRefNumber}`;
  const institutionId = `setu-${fipId}`;
  const holderName = account.profile?.holders?.holder?.[0]?.name ?? fipId;
  const balance = parseFloat(account.summary?.currentBalance ?? "0") || 0;
  const currency = account.summary?.currency ?? "INR";
  const maskedNum = account.maskedAccNumber ?? "";

  // Ensure institution row exists
  db.prepare(`
    INSERT INTO institutions (item_id, access_token, name, products)
    VALUES (?, 'setu', ?, '["transactions"]')
    ON CONFLICT(item_id) DO UPDATE SET name = excluded.name
  `).run(institutionId, fipId);

  // Upsert account
  db.prepare(`
    INSERT INTO accounts
      (account_id, item_id, name, official_name, type, subtype, mask, current_balance, currency, source)
    VALUES
      (?, ?, ?, ?, 'depository', 'savings', ?, ?, ?, 'setu')
    ON CONFLICT(account_id) DO UPDATE SET
      current_balance = excluded.current_balance,
      updated_at = datetime('now')
  `).run(accountId, institutionId, holderName, fipId, maskedNum, balance, currency);

  // Ingest transactions
  const txns = account.transactions?.transaction ?? [];
  let added = 0;

  const upsertTx = db.prepare(`
    INSERT INTO transactions
      (transaction_id, account_id, amount, date, name, category, subcategory, pending, iso_currency_code, payment_channel, source)
    VALUES
      (@txId, @accountId, @amount, @date, @name, @category, @subcategory, 0, @currency, @channel, 'setu')
    ON CONFLICT(transaction_id) DO NOTHING
  `);

  const insertMany = db.transaction(() => {
    for (const tx of txns) {
      const amount = parseFloat(tx.amount) * (tx.type === "DEBIT" ? 1 : -1);
      const date = (tx.valueDate ?? tx.transactionTimestamp ?? "").slice(0, 10);
      const { category, subcategory } = categoryFromSetuMode(tx.mode, tx.narration, tx.type);

      const r = upsertTx.run({
        txId: `setu-${tx.txnId}`,
        accountId,
        amount,
        date,
        name: tx.narration || tx.mode,
        category,
        subcategory,
        currency,
        channel: setuModeToChannel(tx.mode),
      });
      added += r.changes;
    }
  });

  insertMany();
  return { transactionsAdded: added };
}

// ─── Mutual Funds ─────────────────────────────────────────────────────────────

function ingestMutualFundAccount(
  db: Database,
  fipId: string,
  linkRefNumber: string,
  account: SetuMutualFundAccount
): void {
  const accountId = `setu-mf-${linkRefNumber}`;
  const institutionId = `setu-${fipId}`;
  const balance = parseFloat(account.summary?.currentValue ?? "0") || 0;
  const currency = account.summary?.currency ?? "INR";

  db.prepare(`
    INSERT INTO institutions (item_id, access_token, name, products)
    VALUES (?, 'setu', ?, '["investments"]')
    ON CONFLICT(item_id) DO UPDATE SET name = excluded.name
  `).run(institutionId, fipId);

  db.prepare(`
    INSERT INTO accounts
      (account_id, item_id, name, type, subtype, current_balance, currency, source)
    VALUES
      (?, ?, 'Mutual Funds', 'investment', 'mutual fund', ?, ?, 'setu')
    ON CONFLICT(account_id) DO UPDATE SET
      current_balance = excluded.current_balance, updated_at = datetime('now')
  `).run(accountId, institutionId, balance, currency);

  const holdings = account.holdings?.holding ?? [];
  const upsertHolding = db.prepare(`
    INSERT INTO holdings
      (account_id, security_id, quantity, cost_basis, value, price, price_as_of)
    VALUES (@accountId, @secId, @qty, NULL, @value, NULL, @priceAsOf)
    ON CONFLICT(account_id, security_id) DO UPDATE SET
      quantity = excluded.quantity, value = excluded.value, updated_at = datetime('now')
  `);

  const upsertSec = db.prepare(`
    INSERT INTO securities (security_id, name, ticker, type)
    VALUES (@id, @name, @ticker, 'mutual fund')
    ON CONFLICT(security_id) DO NOTHING
  `);

  const insertMany = db.transaction(() => {
    for (const h of holdings) {
      const secId = `setu-mf-${h.isin ?? h.schemeCode ?? h.schemeName}`;
      upsertSec.run({
        id: secId,
        name: h.schemeName ?? "Unknown Fund",
        ticker: h.isin ?? null,
      });
      upsertHolding.run({
        accountId,
        secId,
        qty: parseFloat(h.units ?? h.closingUnits ?? "0") || 0,
        value: parseFloat(h.currentValue ?? "0") || 0,
        priceAsOf: new Date().toISOString().slice(0, 10),
      });
    }
  });

  insertMany();
}

// ─── Equities ─────────────────────────────────────────────────────────────────

function ingestEquityAccount(
  db: Database,
  fipId: string,
  linkRefNumber: string,
  account: SetuEquityAccount
): void {
  const accountId = `setu-eq-${linkRefNumber}`;
  const institutionId = `setu-${fipId}`;
  const balance = parseFloat(account.summary?.currentValue ?? "0") || 0;
  const currency = account.summary?.currency ?? "INR";

  db.prepare(`
    INSERT INTO institutions (item_id, access_token, name, products)
    VALUES (?, 'setu', ?, '["investments"]')
    ON CONFLICT(item_id) DO UPDATE SET name = excluded.name
  `).run(institutionId, fipId);

  db.prepare(`
    INSERT INTO accounts
      (account_id, item_id, name, type, subtype, current_balance, currency, source)
    VALUES
      (?, ?, 'Equities', 'investment', 'brokerage', ?, ?, 'setu')
    ON CONFLICT(account_id) DO UPDATE SET
      current_balance = excluded.current_balance, updated_at = datetime('now')
  `).run(accountId, institutionId, balance, currency);

  const holdings = account.holdings?.holding ?? [];
  const upsertHolding = db.prepare(`
    INSERT INTO holdings
      (account_id, security_id, quantity, cost_basis, value, price, price_as_of)
    VALUES (@accountId, @secId, @qty, NULL, @value, NULL, @priceAsOf)
    ON CONFLICT(account_id, security_id) DO UPDATE SET
      quantity = excluded.quantity, value = excluded.value, updated_at = datetime('now')
  `);

  const upsertSec = db.prepare(`
    INSERT INTO securities (security_id, name, ticker, type)
    VALUES (@id, @name, @ticker, 'equity')
    ON CONFLICT(security_id) DO NOTHING
  `);

  const insertMany = db.transaction(() => {
    for (const h of holdings) {
      const secId = `setu-eq-${h.isin ?? h.name}`;
      upsertSec.run({
        id: secId,
        name: h.name ?? "Unknown Stock",
        ticker: h.isin ?? null,
      });
      upsertHolding.run({
        accountId,
        secId,
        qty: parseFloat(h.units ?? "0") || 0,
        value: parseFloat(h.currentValue ?? "0") || 0,
        priceAsOf: new Date().toISOString().slice(0, 10),
      });
    }
  });

  insertMany();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setuModeToChannel(mode: string): string {
  const m = mode.toUpperCase();
  if (m === "UPI") return "online";
  if (["NEFT", "RTGS", "IMPS"].includes(m)) return "online";
  if (m === "ATM" || m === "CASH") return "in store";
  return "other";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Re-sync all Setu accounts ────────────────────────────────────────────────

/**
 * Find all APPROVED consents and create new sessions to pull fresh data.
 * Called from daily-sync.ts.
 */
export async function syncAllSetuAccounts(db: Database): Promise<SetuSyncResult> {
  const approvedConsents = db
    .prepare(`SELECT consent_id, date_range_from, date_range_to FROM setu_consents WHERE status = 'APPROVED'`)
    .all() as { consent_id: string; date_range_from: string; date_range_to: string }[];

  const total: SetuSyncResult = { accountsLinked: 0, transactionsAdded: 0, holdingsUpdated: 0 };

  for (const consent of approvedConsents) {
    try {
      // Update date range to fetch up to today
      const newTo = new Date().toISOString();
      db.prepare(`UPDATE setu_consents SET date_range_to = ? WHERE consent_id = ?`).run(
        newTo,
        consent.consent_id
      );

      const sessionId = await createSession(db, consent.consent_id);
      const status = await pollSessionUntilReady(db, sessionId);

      if (status === "COMPLETED" || status === "PARTIAL") {
        const r = await fetchAndIngestFIData(db, sessionId);
        total.accountsLinked += r.accountsLinked;
        total.transactionsAdded += r.transactionsAdded;
        total.holdingsUpdated += r.holdingsUpdated;
      } else {
        console.error(`  Setu session ${sessionId} ended with status: ${status}`);
      }
    } catch (err: any) {
      console.error(`  Setu sync error for consent ${consent.consent_id}: ${err.message}`);
    }
  }

  return total;
}
