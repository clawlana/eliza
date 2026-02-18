export type X402Network = "solana" | "solana-devnet";

export interface X402PluginConfig {
  network: X402Network;
  treasuryAddress: string;
  expectedPayTo?: string;
  requirePaymentHeader: boolean;
  paymentHeaderName: string;
  enablePrivyServerPayments: boolean;
  usePrivySdk: boolean;
  privyTrustedHeaders: boolean;
  privyUserIdHeader: string;
  privyWalletHeader: string;
  privyWalletIdHeader: string;
  privyAppId: string;
  privyAppSecret: string;
  privyAuthorizationKey?: string;
  privySolanaCaip2: string;
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
    enablePrivyServerPayments: env.X402_ENABLE_PRIVY_SERVER_PAYMENTS === "true",
    usePrivySdk: env.X402_USE_PRIVY_SDK !== "false",
    privyTrustedHeaders: env.X402_PRIVY_TRUSTED_USER_HEADERS === "true",
    privyUserIdHeader: env.X402_PRIVY_USER_ID_HEADER || "x-privy-user-id",
    privyWalletHeader: env.X402_PRIVY_WALLET_HEADER || "x-privy-wallet-address",
    privyWalletIdHeader: env.X402_PRIVY_WALLET_ID_HEADER || "x-privy-wallet-id",
    privyAppId: env.PRIVY_APP_ID || "",
    privyAppSecret: env.PRIVY_APP_SECRET || "",
    privyAuthorizationKey: env.PRIVY_AUTHORIZATION_KEY,
    privySolanaCaip2: env.X402_PRIVY_SOLANA_CAIP2 || "solana:mainnet",
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

  if (config.enablePrivyServerPayments && !config.privyTrustedHeaders) {
    warnings.push(
      "Privy server payments enabled without trusted headers; provide a Privy adapter for production use",
    );
  }

  if (
    config.enablePrivyServerPayments &&
    config.usePrivySdk &&
    (!config.privyAppId || !config.privyAppSecret)
  ) {
    warnings.push(
      "Privy SDK mode enabled but PRIVY_APP_ID/PRIVY_APP_SECRET are missing; set them or disable X402_USE_PRIVY_SDK",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
