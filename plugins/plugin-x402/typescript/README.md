# @elizaos/plugin-x402

Solana-first x402 payment verification for Eliza plugin routes.

## What it does

- Registers an x402 verifier for the runtime.
- Enforces payment on routes that define `route.x402`.
- Returns a standard `402` payload with `x402Version` and `accepts`.
- Adds an `x-payment-receipt` header when verification succeeds.

## Required environment variables

- `X402_TREASURY_ADDRESS` (required)

Optional:

- `X402_PAY_TO` (defaults to treasury)
- `X402_NETWORK` (`solana` or `solana-devnet`, default `solana`)
- `X402_PAYMENT_HEADER_NAME` (default `x-payment`)
- `X402_REQUIRE_HEADER` (default `true`)

## Route usage

```ts
routes: [
  {
    type: "POST",
    path: "/paid",
    x402: {
      price: "100000", // USDC base units (6 decimals)
      network: "solana",
      payTo: "your-treasury-wallet",
      description: "Premium inference request",
    },
    async handler(req, res) {
      res.status(200).json({ ok: true });
    },
  },
];
```

## Plugin usage

```ts
import { buildX402Plugin } from "@elizaos/plugin-x402";

const x402Plugin = buildX402Plugin();
```

Add the plugin to your runtime's plugin list before routes are served.
