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

interface PrivyVerifyClaims {
  userId?: string;
  sub?: string;
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
  if (config.usePrivySdk && config.privyAppId && config.privyAppSecret) {
    return createPrivySdkAdapter(config);
  }
  if (config.privyTrustedHeaders) {
    return createTrustedHeadersPrivyAdapter(config);
  }
  return undefined;
}

function parseAuthorizationToken(
  context: X402AuthenticatedContext,
): string | undefined {
  const authorization = getHeaderValue(context.req.headers, "authorization");
  if (!authorization) {
    return undefined;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return undefined;
  }
  return match[1];
}

function normalizeClaims(claims: unknown): PrivyVerifyClaims {
  if (!claims || typeof claims !== "object") {
    return {};
  }
  const candidate = claims as Record<string, unknown>;
  return {
    userId:
      typeof candidate.userId === "string" ? candidate.userId : undefined,
    sub: typeof candidate.sub === "string" ? candidate.sub : undefined,
  };
}

async function verifyPrivyAccessToken(
  privyClient: unknown,
  token: string,
): Promise<PrivyVerifyClaims> {
  const client = privyClient as Record<string, unknown>;

  if (typeof client.verifyAuthToken === "function") {
    const claims = await (
      client.verifyAuthToken as (accessToken: string) => Promise<unknown>
    )(token);
    return normalizeClaims(claims);
  }

  if (typeof client.auth === "function") {
    const authApi = (client.auth as () => unknown)();
    if (
      authApi &&
      typeof (authApi as Record<string, unknown>).verifyAuthToken === "function"
    ) {
      const claims = await (
        (authApi as Record<string, unknown>).verifyAuthToken as (
          accessToken: string,
        ) => Promise<unknown>
      )(token);
      return normalizeClaims(claims);
    }
  }

  throw new Error("Privy SDK verifyAuthToken API not found");
}

async function fetchPrivyUser(
  privyClient: unknown,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const client = privyClient as Record<string, unknown>;
  if (typeof client.getUser === "function") {
    return (await (client.getUser as (id: string) => Promise<unknown>)(
      userId,
    )) as Record<string, unknown>;
  }
  if (typeof client.users === "function") {
    const usersApi = (client.users as () => unknown)();
    if (
      usersApi &&
      typeof (usersApi as Record<string, unknown>).get === "function"
    ) {
      return (await (
        (usersApi as Record<string, unknown>).get as (
          id: string,
        ) => Promise<unknown>
      )(userId)) as Record<string, unknown>;
    }
  }
  return null;
}

function pickSolanaWallet(user: Record<string, unknown>): {
  walletId?: string;
  walletAddress?: string;
} {
  const linkedAccounts = Array.isArray(user.linkedAccounts)
    ? user.linkedAccounts
    : [];
  for (const account of linkedAccounts) {
    if (!account || typeof account !== "object") {
      continue;
    }
    const row = account as Record<string, unknown>;
    if (row.type === "wallet" && row.chainType === "solana") {
      const walletAddress =
        typeof row.address === "string" ? row.address : undefined;
      const walletId = typeof row.id === "string" ? row.id : undefined;
      return { walletId, walletAddress };
    }
  }
  return {};
}

async function sendPrivySolanaCharge(
  privyClient: unknown,
  walletId: string,
  config: X402PluginConfig,
  context: X402AuthenticatedContext,
  userJwt: string,
): Promise<{ transaction?: string }> {
  const client = privyClient as Record<string, unknown>;
  if (typeof client.wallets !== "function") {
    throw new Error("Privy SDK wallets() API not found");
  }
  const walletsApi = (client.wallets as () => unknown)();
  if (!walletsApi || typeof (walletsApi as Record<string, unknown>).solana !== "function") {
    throw new Error("Privy SDK wallets().solana() API not found");
  }
  const solanaApi = (
    walletsApi as { solana: () => Record<string, unknown> }
  ).solana();
  const sendTransaction = solanaApi.sendTransaction;
  if (typeof sendTransaction !== "function") {
    throw new Error("Privy SDK wallets().solana().sendTransaction API not found");
  }

  const lamports = Number(context.accepts.maxAmountRequired);
  if (!Number.isFinite(lamports) || lamports <= 0) {
    throw new Error("Invalid maxAmountRequired for server-side charge");
  }

  const response = (await (
    sendTransaction as (
      walletId: string,
      payload: Record<string, unknown>,
    ) => Promise<unknown>
  )(walletId, {
    caip2: config.privySolanaCaip2,
    params: {
      transaction: {
        to: context.accepts.payTo,
        lamports,
      },
    },
    authorization_context: {
      user_jwts: [userJwt],
    },
    idempotency_key: `x402-${Date.now()}`,
  })) as Record<string, unknown>;

  const transactionHash =
    typeof response.signature === "string"
      ? response.signature
      : typeof response.transactionHash === "string"
        ? response.transactionHash
        : typeof response.hash === "string"
          ? response.hash
          : undefined;

  return { transaction: transactionHash };
}

export function createPrivySdkAdapter(config: X402PluginConfig): PrivyAdapter {
  return {
    async authenticate(context) {
      const token = parseAuthorizationToken(context);
      if (!token) {
        return null;
      }

      const { PrivyClient } = (await import("@privy-io/node")) as {
        PrivyClient: new (params: {
          appId: string;
          appSecret: string;
          authorizationPrivateKey?: string;
        }) => unknown;
      };

      const privy = new PrivyClient({
        appId: config.privyAppId,
        appSecret: config.privyAppSecret,
        authorizationPrivateKey: config.privyAuthorizationKey,
      });

      const claims = await verifyPrivyAccessToken(privy, token);
      const userId = claims.userId || claims.sub;
      if (!userId) {
        return null;
      }

      const user = await fetchPrivyUser(privy, userId);
      if (!user) {
        return null;
      }
      const { walletAddress } = pickSolanaWallet(user);
      if (!walletAddress) {
        return null;
      }
      return { userId, walletAddress };
    },
    async charge(user, context) {
      try {
        const token = parseAuthorizationToken(context);
        if (!token) {
          return {
            success: false,
            error: "Missing authorization token for Privy server charge",
            statusCode: 401,
          };
        }

        const walletIdFromHeader = getHeaderValue(
          context.req.headers,
          config.privyWalletIdHeader,
        );
        if (!walletIdFromHeader) {
          return {
            success: false,
            error: `Missing wallet id header (${config.privyWalletIdHeader}) for Privy server charge`,
            statusCode: 400,
          };
        }

        const { PrivyClient } = (await import("@privy-io/node")) as {
          PrivyClient: new (params: {
            appId: string;
            appSecret: string;
            authorizationPrivateKey?: string;
          }) => unknown;
        };

        const privy = new PrivyClient({
          appId: config.privyAppId,
          appSecret: config.privyAppSecret,
          authorizationPrivateKey: config.privyAuthorizationKey,
        });

        const result = await sendPrivySolanaCharge(
          privy,
          walletIdFromHeader,
          config,
          context,
          token,
        );
        return {
          success: true,
          transaction: result.transaction || `privy-charge-${user.userId}-${Date.now()}`,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Privy charge failed",
          statusCode: 502,
        };
      }
    },
  };
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
