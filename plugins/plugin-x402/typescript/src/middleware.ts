import type { Plugin } from "@elizaos/core";
import { registerX402Verifier } from "@elizaos/core";
import {
  resolveX402PluginConfig,
  validateX402PluginConfig,
  type X402PluginConfig,
} from "./config.js";
import { createSolanaX402Verifier } from "./solana.js";

interface BuildX402PluginOptions {
  config?: Partial<X402PluginConfig>;
}

function mergeConfig(
  baseConfig: X402PluginConfig,
  overrides?: Partial<X402PluginConfig>,
): X402PluginConfig {
  if (!overrides) {
    return baseConfig;
  }
  return {
    ...baseConfig,
    ...overrides,
  };
}

export function buildX402Plugin(options: BuildX402PluginOptions = {}): Plugin {
  return {
    name: "x402",
    description:
      "Solana-first x402 payment verifier for paid plugin routes using route.x402 metadata",
    async init(_config, runtime) {
      const effectiveConfig = mergeConfig(
        resolveX402PluginConfig(),
        options.config,
      );

      const validation = validateX402PluginConfig(effectiveConfig);
      if (!validation.valid) {
        throw new Error(
          `[x402] Invalid configuration: ${validation.errors.join(", ")}`,
        );
      }

      const verifier = createSolanaX402Verifier(effectiveConfig);
      registerX402Verifier(runtime, verifier);

      if (validation.warnings.length > 0) {
        runtime.logger.warn(
          {
            src: "plugin",
            plugin: "x402",
            warnings: validation.warnings,
          },
          "x402 plugin initialized with warnings",
        );
      }
    },
  };
}
