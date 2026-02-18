import type {
  IAgentRuntime,
  Route,
  RouteRequest,
  RouteResponse,
} from "../types";
import type { X402Accepts } from "../types/payment";

export interface X402VerificationResult {
  ok: boolean;
  error?: string;
  payer?: string;
  transaction?: string;
  receiptHeaders?: Record<string, string>;
  statusCode?: number;
  responseBody?: Record<string, unknown>;
}

export interface X402VerificationContext {
  req: RouteRequest;
  route: Route;
  runtime: IAgentRuntime;
  accepts: X402Accepts;
  paymentHeader: string;
}

export interface X402AuthenticatedContext {
  req: RouteRequest;
  route: Route;
  runtime: IAgentRuntime;
  accepts: X402Accepts;
}

export interface X402Verifier {
  verify(context: X402VerificationContext): Promise<X402VerificationResult>;
  verifyAuthenticatedPayment?(
    context: X402AuthenticatedContext,
  ): Promise<X402VerificationResult>;
}

const verifierRegistry = new WeakMap<IAgentRuntime, X402Verifier>();

export function registerX402Verifier(
  runtime: IAgentRuntime,
  verifier: X402Verifier,
): void {
  verifierRegistry.set(runtime, verifier);
}

export function unregisterX402Verifier(runtime: IAgentRuntime): void {
  verifierRegistry.delete(runtime);
}

export function getX402Verifier(runtime: IAgentRuntime): X402Verifier | undefined {
  return verifierRegistry.get(runtime);
}

function getHeader(req: RouteRequest, headerName: string): string | undefined {
  const headers = req.headers;
  if (!headers) {
    return undefined;
  }

  const target = headerName.toLowerCase();
  for (const [key, rawValue] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      return rawValue.find((value) => value.length > 0);
    }

    return rawValue;
  }

  return undefined;
}

export function buildX402Accepts(route: Route, req: RouteRequest): X402Accepts {
  const resource =
    req.url ||
    req.path ||
    route.path ||
    "/";
  const network = route.x402?.network || process.env.X402_NETWORK || "solana";
  const payTo = route.x402?.payTo || process.env.X402_PAY_TO || "";
  const description = route.x402?.description || `Payment required for ${route.path}`;

  return {
    scheme: "exact",
    network,
    maxAmountRequired: route.x402?.price || "0",
    resource,
    description,
    mimeType: "application/json",
    payTo,
    maxTimeoutSeconds: 300,
    asset: network.includes("solana") ? "usdc" : "usdc",
  };
}

function writePaymentRequired(
  res: RouteResponse,
  accepts: X402Accepts,
  error = "Payment required",
): void {
  res.status(402).json({
    x402Version: 1,
    error,
    accepts: [accepts],
  });
}

type RouteHandler = NonNullable<Route["handler"]>;

export function wrapX402RouteHandler(
  route: Route,
  handler: RouteHandler,
  runtime: IAgentRuntime,
): RouteHandler {
  return async (req, res, handlerRuntime) => {
    const accepts = buildX402Accepts(route, req);
    const paymentHeader = getHeader(req, "x-payment");
    const verifier = getX402Verifier(runtime);

    if (!verifier) {
      res.status(503).json({
        error: "x402 verifier not configured",
        code: "PAYMENT_SYSTEM_MISCONFIGURED",
      });
      return;
    }

    let result: X402VerificationResult;
    if (paymentHeader) {
      result = await verifier.verify({
        req,
        route,
        runtime: handlerRuntime,
        accepts,
        paymentHeader,
      });
    } else if (verifier.verifyAuthenticatedPayment) {
      result = await verifier.verifyAuthenticatedPayment({
        req,
        route,
        runtime: handlerRuntime,
        accepts,
      });
    } else {
      writePaymentRequired(res, accepts);
      return;
    }

    if (!result.ok) {
      if (result.statusCode && result.statusCode !== 402) {
        res
          .status(result.statusCode)
          .json(result.responseBody || { error: result.error || "Payment failed" });
        return;
      }
      writePaymentRequired(res, accepts, result.error || "Payment verification failed");
      return;
    }

    if (res.setHeader && result.receiptHeaders) {
      for (const [key, value] of Object.entries(result.receiptHeaders)) {
        res.setHeader(key, value);
      }
    }

    await handler(req, res, handlerRuntime);
  };
}
