import type {
  X402AuthenticatedContext,
  X402VerificationContext,
  X402VerificationResult,
  X402Verifier,
} from "@elizaos/core";
import type { X402PluginConfig } from "./config.js";

interface SolanaPaymentPayload {
  payer?: string;
  transaction?: string;
  network?: string;
  payTo?: string;
}

export interface AuthenticatedUserContext {
  userId: string;
  walletAddress: string;
}

export interface PrivyServerChargeResult {
  success: boolean;
  transaction?: string;
  error?: string;
  statusCode?: number;
}

export interface PrivyAdapter {
  authenticate(
    context: X402AuthenticatedContext,
  ): Promise<AuthenticatedUserContext | null>;
  charge(
    user: AuthenticatedUserContext,
    context: X402AuthenticatedContext,
  ): Promise<PrivyServerChargeResult>;
}

function parsePaymentHeader(rawHeader: string): SolanaPaymentPayload | null {
  try {
    return JSON.parse(rawHeader) as SolanaPaymentPayload;
  } catch {
    try {
      const decoded = Buffer.from(rawHeader, "base64").toString("utf8");
      return JSON.parse(decoded) as SolanaPaymentPayload;
    } catch {
      return null;
    }
  }
}

function isValidPubkey(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  // Lightweight base58 validation to avoid runtime dependency on web3 in core plugin tests.
  // Solana pubkeys are typically 32-44 chars and use Bitcoin base58 alphabet.
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function buildReceiptHeader(
  payload: SolanaPaymentPayload,
  context: X402VerificationContext,
): string {
  const receipt = {
    x402Version: 1,
    network: payload.network || context.accepts.network,
    payer: payload.payer,
    transaction: payload.transaction,
    payTo: payload.payTo || context.accepts.payTo,
    resource: context.accepts.resource,
    amount: context.accepts.maxAmountRequired,
    verifiedAt: new Date().toISOString(),
  };

  return Buffer.from(JSON.stringify(receipt)).toString("base64");
}

function getHeaderValue(
  headers: X402AuthenticatedContext["req"]["headers"],
  headerName: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const targetName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== targetName) {
      continue;
    }
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
  return undefined;
}

function buildServerReceiptHeader(
  user: AuthenticatedUserContext,
  transaction: string,
  context: X402AuthenticatedContext,
): string {
  const receipt = {
    x402Version: 1,
    mode: "privy-server",
    network: context.accepts.network,
    payer: user.walletAddress,
    transaction,
    payTo: context.accepts.payTo,
    resource: context.accepts.resource,
    amount: context.accepts.maxAmountRequired,
    userId: user.userId,
    chargedAt: new Date().toISOString(),
  };
  return Buffer.from(JSON.stringify(receipt)).toString("base64");
}

function createTrustedHeadersPrivyAdapter(
  config: X402PluginConfig,
): PrivyAdapter {
  return {
    async authenticate(context) {
      const userId = getHeaderValue(context.req.headers, config.privyUserIdHeader);
      const walletAddress = getHeaderValue(
        context.req.headers,
        config.privyWalletHeader,
      );
      if (!userId || !walletAddress) {
        return null;
      }
      if (!isValidPubkey(walletAddress)) {
        return null;
      }
      return { userId, walletAddress };
    },
    async charge(user) {
      return {
        success: true,
        transaction: `server-charge-${user.userId}-${Date.now()}`,
      };
    },
  };
}

function resolvePrivyAdapter(
  config: X402PluginConfig,
  customAdapter?: PrivyAdapter,
): PrivyAdapter | undefined {
  if (!config.enablePrivyServerPayments) {
    return undefined;
  }
  if (customAdapter) {
    return customAdapter;
  }
  if (config.privyTrustedHeaders) {
    return createTrustedHeadersPrivyAdapter(config);
  }
  return undefined;
}

export function createSolanaX402Verifier(
  config: X402PluginConfig,
  options: { privyAdapter?: PrivyAdapter } = {},
): X402Verifier {
  const privyAdapter = resolvePrivyAdapter(config, options.privyAdapter);

  return {
    async verify(
      context: X402VerificationContext,
    ): Promise<X402VerificationResult> {
      const payload = parsePaymentHeader(context.paymentHeader);
      if (!payload) {
        return {
          ok: false,
          error: "Invalid x-payment header payload",
        };
      }

      if (!isValidPubkey(payload.payer)) {
        return {
          ok: false,
          error: "Invalid payer address in x-payment header",
        };
      }

      if (!payload.transaction || payload.transaction.length < 16) {
        return {
          ok: false,
          error: "Missing or invalid transaction in x-payment header",
        };
      }

      if (payload.network && payload.network !== config.network) {
        return {
          ok: false,
          error: `Network mismatch: expected ${config.network}, got ${payload.network}`,
        };
      }

      if (
        config.expectedPayTo &&
        payload.payTo &&
        payload.payTo !== config.expectedPayTo
      ) {
        return {
          ok: false,
          error: "Payment recipient mismatch",
        };
      }

      return {
        ok: true,
        payer: payload.payer,
        transaction: payload.transaction,
        receiptHeaders: {
          "x-payment-receipt": buildReceiptHeader(payload, context),
        },
      };
    },
    async verifyAuthenticatedPayment(
      context: X402AuthenticatedContext,
    ): Promise<X402VerificationResult> {
      if (!config.enablePrivyServerPayments) {
        return {
          ok: false,
          error: "Payment required",
          statusCode: 402,
        };
      }

      if (!privyAdapter) {
        return {
          ok: false,
          error: "Privy payment adapter is not configured",
          statusCode: 503,
          responseBody: {
            error: "Privy payment adapter is not configured",
            code: "PAYMENT_SYSTEM_MISCONFIGURED",
          },
        };
      }

      const user = await privyAdapter.authenticate(context);
      if (!user) {
        return {
          ok: false,
          error: "Payment required",
          statusCode: 402,
        };
      }

      const chargeResult = await privyAdapter.charge(user, context);
      if (!chargeResult.success) {
        return {
          ok: false,
          error: chargeResult.error || "Privy server-side charge failed",
          statusCode: chargeResult.statusCode || 402,
          responseBody: {
            error: chargeResult.error || "Privy server-side charge failed",
            code: "PAYMENT_FAILED",
          },
        };
      }

      const transaction =
        chargeResult.transaction || `server-charge-${Date.now()}`;
      return {
        ok: true,
        payer: user.walletAddress,
        transaction,
        receiptHeaders: {
          "x-payment-receipt": buildServerReceiptHeader(user, transaction, context),
        },
      };
    },
  };
}
