import { PublicKey } from "@solana/web3.js";
import type {
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
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
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

export function createSolanaX402Verifier(
  config: X402PluginConfig,
): X402Verifier {
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
  };
}
