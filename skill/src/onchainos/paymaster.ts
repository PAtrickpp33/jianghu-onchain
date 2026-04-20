// OnchainOS Paymaster policy helpers.
//
// Authoritative reference: docs/TECHNICAL_DESIGN.md §4.3
//
// The Paymaster sponsors gas for end users so that the Xiake skill is "zero
// ETH required" from the player's perspective. Policy definitions live in the
// Dev Portal — this module just provides convenience wrappers for:
//
//   • reading the default / skill-owned policy id
//   • checking whether a given (from, to, selector) is covered
//   • attaching a policy id to an existing SignAndSendInput
//
// We intentionally keep this as a pure helper layer (no network calls unless a
// lookup is explicitly requested) so it can be composed into higher-level tool
// handlers without extra round-trips.

import { request } from "./client.js";
import type { SignAndSendInput } from "./gateway.js";

/**
 * The policy id the skill will use by default. Either injected via env
 * (preferred, so ops can rotate without a redeploy) or falls back to the
 * well-known Dev Portal policy configured for the Xiake project.
 */
export function getDefaultPolicyId(): string | undefined {
  return process.env.OKX_PAYMASTER_POLICY_ID || undefined;
}

/**
 * Return a shallow copy of `input` with the default paymaster policy id
 * attached (if one is configured). If the caller already passed a
 * `paymasterPolicyId`, we leave it untouched — explicit beats default.
 */
export function withGasless<T extends SignAndSendInput>(input: T): T {
  if (input.paymasterPolicyId) return input;
  const policyId = getDefaultPolicyId();
  if (!policyId) return input;
  return { ...input, paymasterPolicyId: policyId };
}

export interface PaymasterPolicy {
  policyId: string;
  name: string;
  /** Contracts this policy will sponsor gas for. */
  targets: `0x${string}`[];
  /** Remaining gas sponsorship budget, in wei as a decimal string. */
  remainingBudget: string;
  /** True when the policy is enabled and has budget remaining. */
  active: boolean;
}

/**
 * Fetch the current state of a paymaster policy. Useful for a "health check"
 * during `xiake_init` — we can surface a clear error when the sponsor wallet
 * is empty instead of letting tx submissions fail downstream.
 */
export async function getPolicy(policyId: string): Promise<PaymasterPolicy> {
  const raw = await request<RawPolicy>("GET", "/api/v5/onchain-gateway/paymaster/policy", {
    query: { policyId },
  });
  return {
    policyId: raw.policyId,
    name: raw.name ?? policyId,
    targets: (raw.targets ?? []).map((t) => t as `0x${string}`),
    remainingBudget: raw.remainingBudget ?? "0",
    active: Boolean(raw.active),
  };
}

/**
 * Check that the default policy is loaded, enabled, has budget, and covers
 * the given contract addresses. Returns `null` when everything is fine, or a
 * human-readable reason when something is off. Used for preflight checks.
 */
export async function preflight(requiredTargets: `0x${string}`[]): Promise<string | null> {
  const policyId = getDefaultPolicyId();
  if (!policyId) return "OKX_PAYMASTER_POLICY_ID not set — gasless transactions disabled.";
  let policy: PaymasterPolicy;
  try {
    policy = await getPolicy(policyId);
  } catch (err) {
    return `paymaster policy ${policyId} unreadable: ${(err as Error).message}`;
  }
  if (!policy.active) return `paymaster policy ${policyId} is disabled.`;
  if (policy.remainingBudget === "0") return `paymaster policy ${policyId} is out of budget.`;
  const covered = new Set(policy.targets.map((t) => t.toLowerCase()));
  const missing = requiredTargets.filter((t) => !covered.has(t.toLowerCase()));
  if (missing.length > 0) {
    return `paymaster policy ${policyId} does not sponsor ${missing.join(", ")}.`;
  }
  return null;
}

interface RawPolicy {
  policyId: string;
  name?: string;
  targets?: string[];
  remainingBudget?: string;
  active?: boolean;
}
