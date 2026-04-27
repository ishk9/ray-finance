// ─── Auth ────────────────────────────────────────────────────────────────────

export interface SetuTokenResponse {
  // Setu uses either field name depending on the product
  access_token?: string;
  token?: string;
  expires_in?: number;
  expiresIn?: number;
  token_type?: string;
  success?: boolean;
}

// ─── Consent ─────────────────────────────────────────────────────────────────

export type SetuConsentStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "REVOKED"
  | "PAUSED";

export type SetuFIType =
  | "DEPOSIT"
  | "MUTUAL_FUNDS"
  | "EQUITIES"
  | "ETF"
  | "TERM_DEPOSIT"
  | "RECURRING_DEPOSIT"
  | "SIP"
  | "INSURANCE_POLICIES"
  | "NPS"
  | "LOAN_ACCOUNTS";

export interface SetuConsentRequest {
  consentDuration: { unit: "MONTH" | "YEAR" | "DAY"; value: string };
  vua: string; // e.g. "9999999999@onemoney"
  dataRange: { from: string; to: string };
  redirectUrl?: string;
  context?: Array<{ key: string; value: string }>;
}

export interface SetuConsentResponse {
  id: string;
  url: string;
  status: SetuConsentStatus;
  detail?: {
    fiTypes: SetuFIType[];
    vua: string;
    dataRange: { from: string; to: string };
    consentExpiry: string;
  };
  traceId?: string;
}

// ─── Data Session ─────────────────────────────────────────────────────────────

export type SetuSessionStatus =
  | "PENDING"
  | "PARTIAL"
  | "COMPLETED"
  | "EXPIRED"
  | "FAILED";

export interface SetuSessionRequest {
  consentId: string;
  dataRange: { from: string; to: string };
  format?: "json";
}

export interface SetuSessionResponse {
  id: string;
  status: SetuSessionStatus;
  consentId: string;
  traceId?: string;
}

// ─── FI Data ─────────────────────────────────────────────────────────────────

export interface SetuHolder {
  name: string;
  mobile?: string;
  email?: string;
  pan?: string;
  dob?: string;
  address?: string;
  nominee?: string;
}

export interface SetuAccountProfile {
  holders: {
    type: "SINGLE" | "JOINT";
    holder: SetuHolder[];
  };
}

export interface SetuAccountSummary {
  currentBalance: string;
  currency: string;
  ifscCode?: string;
  micrCode?: string;
  branch?: string;
  status?: string;
  type?: string;
  openingDate?: string;
}

export interface SetuTransaction {
  txnId: string;
  amount: string;
  type: "CREDIT" | "DEBIT";
  mode: string; // UPI, NEFT, RTGS, IMPS, NACH, etc.
  narration: string;
  reference?: string;
  currentBalance?: string;
  transactionTimestamp: string;
  valueDate?: string;
}

export interface SetuDepositAccount {
  type: "deposit";
  maskedAccNumber: string;
  linkedAccRef?: string;
  version?: string;
  profile?: SetuAccountProfile;
  summary?: SetuAccountSummary;
  transactions?: {
    startDate?: string;
    endDate?: string;
    transaction: SetuTransaction[];
  };
}

export interface SetuMutualFundHolding {
  isin?: string;
  amc?: string;
  schemeName?: string;
  schemeCode?: string;
  schemeType?: string;
  nav?: string;
  currentValue?: string;
  units?: string;
  folioNo?: string;
  closingUnits?: string;
}

export interface SetuMutualFundAccount {
  type: "mutual_fund";
  maskedAccNumber?: string;
  summary?: { currentValue?: string; currency?: string };
  holdings?: { holding: SetuMutualFundHolding[] };
}

export interface SetuEquityAccount {
  type: "equities";
  maskedAccNumber?: string;
  summary?: { currentValue?: string; currency?: string };
  holdings?: {
    holding: Array<{
      isin?: string;
      name?: string;
      exchange?: string;
      currentValue?: string;
      units?: string;
    }>;
  };
}

export type SetuFIAccount =
  | SetuDepositAccount
  | SetuMutualFundAccount
  | SetuEquityAccount;

export interface SetuFIDataEntry {
  linkRefNumber: string;
  maskedAccNumber: string;
  decryptedFI: {
    account: SetuFIAccount;
  };
}

export interface SetuFIPData {
  fipID: string;
  data: SetuFIDataEntry[];
}

export interface SetuFIDataResponse {
  fiData: SetuFIPData[];
  status?: string;
  traceId?: string;
}

// ─── Webhook Payload ──────────────────────────────────────────────────────────

export interface SetuConsentNotification {
  type: "CONSENT_STATUS_UPDATE";
  timestamp: string;
  consentId: string;
  success: boolean;
  data: {
    status: SetuConsentStatus;
  };
}

export interface SetuSessionNotification {
  type: "SESSION_STATUS_UPDATE";
  timestamp: string;
  dataSessionId: string;
  consentId: string;
  success: boolean;
  data: {
    status: SetuSessionStatus;
    fips: Array<{
      fipID: string;
      accounts: Array<{
        FIStatus: string;
        description: string;
        linkRefNumber: string;
      }>;
    }>;
    format: string;
  };
}

export type SetuWebhookPayload = SetuConsentNotification | SetuSessionNotification;

// ─── Sync Result ──────────────────────────────────────────────────────────────

export interface SetuSyncResult {
  accountsLinked: number;
  transactionsAdded: number;
  holdingsUpdated: number;
}

// ─── AA Handle options ────────────────────────────────────────────────────────

export const AA_HANDLES = [
  { name: "OneMoney", value: "onemoney" },
  { name: "Setu (sandbox/testing)", value: "setu" },
  { name: "CAMS FinServ", value: "camsaa" },
  { name: "Perfios", value: "perfios" },
  { name: "Anumati", value: "anumati" },
] as const;

export type AAHandle = (typeof AA_HANDLES)[number]["value"];
