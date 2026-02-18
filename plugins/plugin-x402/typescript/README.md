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
- `X402_ENABLE_PRIVY_SERVER_PAYMENTS` (default `false`)
- `X402_PRIVY_TRUSTED_USER_HEADERS` (default `false`)
- `X402_PRIVY_USER_ID_HEADER` (default `x-privy-user-id`)
- `X402_PRIVY_WALLET_HEADER` (default `x-privy-wallet-address`)

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

## Privy-style server payment mode

The plugin supports a server-side authenticated flow when `x-payment` is not present:

- Enable `X402_ENABLE_PRIVY_SERVER_PAYMENTS=true`
- Provide either:
  - a custom `privyAdapter` to `buildX402Plugin({...})` (recommended for production), or
  - `X402_PRIVY_TRUSTED_USER_HEADERS=true` plus trusted gateway headers

Custom adapter example:

```ts
import { buildX402Plugin, type PrivyAdapter } from "@elizaos/plugin-x402";

const privyAdapter: PrivyAdapter = {
  async authenticate(context) {
    // Verify Privy token/cookie and return authenticated user + wallet
    return { userId: "privy-user-id", walletAddress: "wallet-address" };
  },
  async charge(user, context) {
    // Call your wallet service and return charge result
    return { success: true, transaction: "server-charge-txid" };
  },
};

const x402Plugin = buildX402Plugin({ privyAdapter });
```
