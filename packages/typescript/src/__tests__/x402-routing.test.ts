import { afterEach, describe, expect, it } from "vitest";
import {
  registerX402Verifier,
  unregisterX402Verifier,
  wrapX402RouteHandler,
} from "../payments/x402";
import type { IAgentRuntime, Route, RouteRequest, RouteResponse } from "../types";

interface MockResponseState {
  statusCode: number;
  jsonBody: unknown;
  headers: Record<string, string | string[]>;
}

function createMockResponse(): {
  response: RouteResponse;
  state: MockResponseState;
} {
  const state: MockResponseState = {
    statusCode: 200,
    jsonBody: undefined,
    headers: {},
  };

  const response: RouteResponse = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(data: unknown) {
      state.jsonBody = data;
      return response;
    },
    send(data: unknown) {
      state.jsonBody = data;
      return response;
    },
    end() {
      return response;
    },
    setHeader(name: string, value: string | string[]) {
      state.headers[name] = value;
      return response;
    },
  };

  return { response, state };
}

function createMockRoute(): Route {
  return {
    type: "POST",
    path: "/paid",
    x402: {
      price: "100000",
      network: "solana",
      payTo: "treasury-wallet-address",
      description: "Paid route",
    },
    async handler(_req, res) {
      res.status(200).json({ ok: true });
    },
  };
}

const runtime = { agentId: "test-agent" } as IAgentRuntime;

afterEach(() => {
  unregisterX402Verifier(runtime);
});

describe("x402 route wrapper", () => {
  it("returns 402 when payment header is missing", async () => {
    const route = createMockRoute();
    const wrapped = wrapX402RouteHandler(route, route.handler!, runtime);
    registerX402Verifier(runtime, {
      async verify() {
        return { ok: false, error: "missing payment" };
      },
    });

    const { response, state } = createMockResponse();
    await wrapped({ headers: {}, url: "/paid" }, response, runtime);

    expect(state.statusCode).toBe(402);
    expect(state.jsonBody).toMatchObject({
      x402Version: 1,
      error: "Payment required",
    });
  });

  it("passes route handler and sets receipt headers when verifier succeeds", async () => {
    const route = createMockRoute();
    const wrapped = wrapX402RouteHandler(route, route.handler!, runtime);

    registerX402Verifier(runtime, {
      async verify() {
        return {
          ok: true,
          receiptHeaders: {
            "x-payment-receipt": "receipt-value",
          },
        };
      },
    });

    const { response, state } = createMockResponse();
    const req: RouteRequest = {
      headers: {
        "x-payment": '{"payer":"wallet","transaction":"tx"}',
      },
      url: "/paid",
    };

    await wrapped(req, response, runtime);

    expect(state.statusCode).toBe(200);
    expect(state.jsonBody).toEqual({ ok: true });
    expect(state.headers["x-payment-receipt"]).toBe("receipt-value");
  });

  it("fails closed with 503 when verifier is missing but payment header exists", async () => {
    const route = createMockRoute();
    const wrapped = wrapX402RouteHandler(route, route.handler!, runtime);

    const { response, state } = createMockResponse();
    await wrapped(
      {
        headers: {
          "x-payment": '{"payer":"wallet","transaction":"tx"}',
        },
      },
      response,
      runtime,
    );

    expect(state.statusCode).toBe(503);
    expect(state.jsonBody).toMatchObject({
      code: "PAYMENT_SYSTEM_MISCONFIGURED",
    });
  });

  it("supports authenticated server-side payment path when no x-payment header", async () => {
    const route = createMockRoute();
    const wrapped = wrapX402RouteHandler(route, route.handler!, runtime);

    registerX402Verifier(runtime, {
      async verify() {
        return { ok: false, error: "not used in this test" };
      },
      async verifyAuthenticatedPayment() {
        return {
          ok: true,
          payer: "privy-user-wallet",
          transaction: "server-charge-123",
          receiptHeaders: {
            "x-payment-receipt": "server-receipt",
          },
        };
      },
    });

    const { response, state } = createMockResponse();
    await wrapped(
      {
        headers: {
          authorization: "Bearer test-token",
        },
        url: "/paid",
      },
      response,
      runtime,
    );

    expect(state.statusCode).toBe(200);
    expect(state.jsonBody).toEqual({ ok: true });
    expect(state.headers["x-payment-receipt"]).toBe("server-receipt");
  });
});
