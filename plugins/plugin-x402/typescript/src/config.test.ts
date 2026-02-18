import { describe, expect, it } from "vitest";
import {
  resolveX402PluginConfig,
  validateX402PluginConfig,
} from "./config.js";

describe("x402 plugin config", () => {
  it("fails closed when treasury address is missing", () => {
    const config = resolveX402PluginConfig({
      X402_NETWORK: "solana",
      X402_TREASURY_ADDRESS: "",
      X402_PAY_TO: "",
    });

    const validation = validateX402PluginConfig(config);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain("X402_TREASURY_ADDRESS is required");
  });

  it("is valid when treasury address is provided", () => {
    const config = resolveX402PluginConfig({
      X402_NETWORK: "solana",
      X402_TREASURY_ADDRESS: "treasury-wallet",
      X402_PAY_TO: "treasury-wallet",
    });

    const validation = validateX402PluginConfig(config);
    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);
  });
});
