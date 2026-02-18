export type X402Network = "solana" | "solana-devnet";

export interface X402PluginConfig {
  network: X402Network;
  treasuryAddress: string;
  expectedPayTo?: string;
  requirePaymentHeader: boolean;
  paymentHeaderName: string;
}

export interface X402ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function parseNetwork(rawNetwork: string | undefined): X402Network {
  if (rawNetwork === "solana" || rawNetwork === "solana-devnet") {
    return rawNetwork;
  }
  return "solana";
}

export function resolveX402PluginConfig(
  env: Record<string, string | undefined> = process.env,
): X402PluginConfig {
  return {
    network: parseNetwork(env.X402_NETWORK),
    treasuryAddress: env.X402_TREASURY_ADDRESS || "",
    expectedPayTo: env.X402_PAY_TO || env.X402_TREASURY_ADDRESS || "",
    requirePaymentHeader: env.X402_REQUIRE_HEADER !== "false",
    paymentHeaderName: env.X402_PAYMENT_HEADER_NAME || "x-payment",
  };
}

export function validateX402PluginConfig(
  config: X402PluginConfig,
): X402ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.treasuryAddress) {
    errors.push("X402_TREASURY_ADDRESS is required");
  }

  if (!config.expectedPayTo) {
    warnings.push(
      "X402_PAY_TO is not set; middleware will only validate the payment header shape",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
