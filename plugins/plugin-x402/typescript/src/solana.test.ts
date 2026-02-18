import { describe, expect, it } from "vitest";
import { createSolanaX402Verifier, type PrivyAdapter } from "./solana.js";
import type { X402PluginConfig } from "./config.js";
import type { X402AuthenticatedContext, X402VerificationContext } from "@elizaos/core";

const baseConfig: X402PluginConfig = {
  network: "solana",
  treasuryAddress: "treasury-wallet",
  expectedPayTo: "treasury-wallet",
  requirePaymentHeader: true,
  paymentHeaderName: "x-payment",
  enablePrivyServerPayments: true,
  privyTrustedHeaders: false,
  privyUserIdHeader: "x-privy-user-id",
  privyWalletHeader: "x-privy-wallet-address",
};

function buildExternalContext(paymentHeader: string): X402VerificationContext {
  return {
    req: { headers: {}, url: "/x402" },
    route: {
      type: "POST",
      path: "/x402",
      x402: {
        price: "100000",
        network: "solana",
        payTo: "treasury-wallet",
        description: "Paid route",
      },
    },
    runtime: {} as never,
    accepts: {
      scheme: "exact",
      network: "solana",
      maxAmountRequired: "100000",
      resource: "/x402",
      description: "Paid route",
      mimeType: "application/json",
      payTo: "treasury-wallet",
      maxTimeoutSeconds: 300,
      asset: "usdc",
    },
    paymentHeader,
  };
}

function buildAuthenticatedContext(
  headers: Record<string, string>,
): X402AuthenticatedContext {
  return {
    req: { headers, url: "/x402" },
    route: {
      type: "POST",
      path: "/x402",
      x402: {
        price: "100000",
        network: "solana",
      },
    },
    runtime: {} as never,
    accepts: {
      scheme: "exact",
      network: "solana",
      maxAmountRequired: "100000",
      resource: "/x402",
      description: "Paid route",
      mimeType: "application/json",
      payTo: "treasury-wallet",
      maxTimeoutSeconds: 300,
      asset: "usdc",
    },
  };
}

describe("createSolanaX402Verifier", () => {
  it("validates standard x-payment payload", async () => {
    const verifier = createSolanaX402Verifier(baseConfig);
    const payload = JSON.stringify({
      payer: "11111111111111111111111111111111",
      transaction: "tx-1234567890123456",
      network: "solana",
      payTo: "treasury-wallet",
    });
    const result = await verifier.verify(buildExternalContext(payload));
    expect(result.ok).toBe(true);
    expect(result.receiptHeaders?.["x-payment-receipt"]).toBeDefined();
  });

  it("supports server-side Privy payment through adapter", async () => {
    const adapter: PrivyAdapter = {
      async authenticate() {
        return {
          userId: "privy-user-1",
          walletAddress: "11111111111111111111111111111111",
        };
      },
      async charge() {
        return {
          success: true,
          transaction: "privy-server-charge-1",
        };
      },
    };
    const verifier = createSolanaX402Verifier(baseConfig, {
      privyAdapter: adapter,
    });

    const result = await verifier.verifyAuthenticatedPayment!(
      buildAuthenticatedContext({ authorization: "Bearer token" }),
    );

    expect(result.ok).toBe(true);
    expect(result.transaction).toBe("privy-server-charge-1");
    expect(result.receiptHeaders?.["x-payment-receipt"]).toBeDefined();
  });
});
