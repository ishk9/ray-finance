/**
 * Maps Setu transaction modes and narration patterns to Ray's category system.
 * Ray uses Plaid's personal_finance_category taxonomy internally.
 */

interface CategoryResult {
  category: string;
  subcategory: string;
}

const MODE_MAP: Record<string, CategoryResult> = {
  UPI: { category: "TRANSFER_IN", subcategory: "TRANSFER_IN_ACCOUNT_TRANSFER" },
  NEFT: { category: "TRANSFER_IN", subcategory: "TRANSFER_IN_ACCOUNT_TRANSFER" },
  RTGS: { category: "TRANSFER_IN", subcategory: "TRANSFER_IN_ACCOUNT_TRANSFER" },
  IMPS: { category: "TRANSFER_IN", subcategory: "TRANSFER_IN_ACCOUNT_TRANSFER" },
  NACH: { category: "LOAN_PAYMENTS", subcategory: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" },
  ECS: { category: "LOAN_PAYMENTS", subcategory: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" },
  ATM: { category: "BANK_FEES", subcategory: "BANK_FEES_ATM_FEES" },
  CASH: { category: "GENERAL_MERCHANDISE", subcategory: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE" },
  CHEQUE: { category: "TRANSFER_IN", subcategory: "TRANSFER_IN_ACCOUNT_TRANSFER" },
  SI: { category: "TRANSFER_OUT", subcategory: "TRANSFER_OUT_ACCOUNT_TRANSFER" }, // Standing Instruction
};

// Narration keyword patterns → category overrides
const NARRATION_PATTERNS: Array<{
  patterns: RegExp[];
  result: CategoryResult;
}> = [
  {
    patterns: [/salary|sal\/|payroll/i],
    result: { category: "INCOME", subcategory: "INCOME_WAGES" },
  },
  {
    patterns: [/interest|int cr/i],
    result: { category: "INCOME", subcategory: "INCOME_OTHER_INCOME" },
  },
  {
    patterns: [/dividend|div/i],
    result: { category: "INCOME", subcategory: "INCOME_DIVIDENDS" },
  },
  {
    patterns: [/rent/i],
    result: { category: "RENT_AND_UTILITIES", subcategory: "RENT_AND_UTILITIES_RENT" },
  },
  {
    patterns: [/electricity|power|bescom|mseb|tpddl|adani electric/i],
    result: { category: "RENT_AND_UTILITIES", subcategory: "RENT_AND_UTILITIES_ELECTRICITY" },
  },
  {
    patterns: [/gas|gas bill|mahanagar gas|indraprastha gas/i],
    result: { category: "RENT_AND_UTILITIES", subcategory: "RENT_AND_UTILITIES_GAS" },
  },
  {
    patterns: [/broadband|internet|jio fiber|airtel|bsnl/i],
    result: { category: "RENT_AND_UTILITIES", subcategory: "RENT_AND_UTILITIES_INTERNET_AND_CABLE" },
  },
  {
    patterns: [/mobile|recharge|prepaid|postpaid/i],
    result: { category: "RENT_AND_UTILITIES", subcategory: "RENT_AND_UTILITIES_TELEPHONE" },
  },
  {
    patterns: [/insurance|lic|hdfc life|icici pru|star health/i],
    result: { category: "GENERAL_SERVICES", subcategory: "GENERAL_SERVICES_INSURANCE" },
  },
  {
    patterns: [/mutual fund|sip|elss|nav/i],
    result: { category: "TRANSFER_OUT", subcategory: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS" },
  },
  {
    patterns: [/emi|loan|credit card|cc bill/i],
    result: { category: "LOAN_PAYMENTS", subcategory: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENTS" },
  },
  {
    patterns: [/zomato|swiggy|blinkit|dunzo|bigbasket|grofers/i],
    result: { category: "FOOD_AND_DRINK", subcategory: "FOOD_AND_DRINK_GROCERIES" },
  },
  {
    patterns: [/amazon|flipkart|myntra|ajio|nykaa|meesho/i],
    result: { category: "GENERAL_MERCHANDISE", subcategory: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES" },
  },
  {
    patterns: [/uber|ola|rapido|auto|cab/i],
    result: { category: "TRANSPORTATION", subcategory: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES" },
  },
  {
    patterns: [/irctc|train|railway|metro/i],
    result: { category: "TRANSPORTATION", subcategory: "TRANSPORTATION_PUBLIC_TRANSIT" },
  },
  {
    patterns: [/spicejet|indigo|air india|go first|vistara|flight/i],
    result: { category: "TRAVEL", subcategory: "TRAVEL_FLIGHTS" },
  },
  {
    patterns: [/hotel|oyo|makemytrip|goibibo|airbnb/i],
    result: { category: "TRAVEL", subcategory: "TRAVEL_LODGING" },
  },
  {
    patterns: [/netflix|hotstar|amazon prime|spotify|prime video/i],
    result: { category: "ENTERTAINMENT", subcategory: "ENTERTAINMENT_TV_AND_MOVIES" },
  },
  {
    patterns: [/atm|cash withdrawal|cash dep/i],
    result: { category: "BANK_FEES", subcategory: "BANK_FEES_ATM_FEES" },
  },
];

/**
 * Given a Setu transaction mode, narration, and type (DEBIT/CREDIT),
 * returns the closest matching Plaid-style category.
 */
export function categoryFromSetuMode(
  mode: string,
  narration: string,
  type: "DEBIT" | "CREDIT"
): CategoryResult {
  // Check narration patterns first (more specific)
  for (const { patterns, result } of NARRATION_PATTERNS) {
    if (patterns.some((p) => p.test(narration))) {
      // For CREDIT transactions, override to INCOME or TRANSFER_IN if not already
      if (type === "CREDIT" && result.category === "TRANSFER_IN") {
        return result;
      }
      if (type === "CREDIT" && result.category === "INCOME") {
        return result;
      }
      if (type === "DEBIT") {
        return result;
      }
    }
  }

  // Fall back to mode-based mapping
  const modeKey = mode.toUpperCase();
  const modeResult = MODE_MAP[modeKey];
  if (modeResult) {
    if (type === "CREDIT") {
      return { category: "TRANSFER_IN", subcategory: "TRANSFER_IN_ACCOUNT_TRANSFER" };
    }
    return modeResult;
  }

  // Generic fallback
  return type === "CREDIT"
    ? { category: "TRANSFER_IN", subcategory: "TRANSFER_IN_ACCOUNT_TRANSFER" }
    : { category: "GENERAL_MERCHANDISE", subcategory: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE" };
}
