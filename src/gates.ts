import type { BriefMeta, HumanGate, Stage } from "./types.js";

/** The only conditional the phase graph understands. Unknown conditions fail closed. */
export const OPEN_QUESTIONS_CONDITION = "brief.meta.openQuestions is non-empty";

export function isKnownGateCondition(condition: string | undefined): boolean {
  return condition?.trim() === OPEN_QUESTIONS_CONDITION;
}

/**
 * Whether a conditional gate should block.
 * A malformed brief meta or an unknown condition blocks (fail closed).
 */
export function evaluateGateCondition(condition: string | undefined, briefMeta: BriefMeta | null): boolean {
  if (!isKnownGateCondition(condition)) {
    return true;
  }
  if (briefMeta?.malformed) {
    return true;
  }
  return (briefMeta?.openQuestions.length ?? 0) > 0;
}

export function gateBlocks(
  gate: HumanGate,
  gateState: string | undefined,
  briefMeta: BriefMeta | null,
  verdict?: string,
): boolean {
  if (gateState === "passed") {
    return false;
  }
  if (gate.whenVerdict && verdict && verdict !== gate.whenVerdict) {
    return false;
  }
  if (gate.required === "conditional") {
    return evaluateGateCondition(gate.condition, briefMeta);
  }
  return true;
}

export function retryBlockReason(stage: Stage, attempts: number | undefined): string | null {
  if (attempts === undefined) {
    return null;
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    return `attempts.${stage.id} must be a positive integer`;
  }
  if (attempts > stage.retryLimit) {
    const target = stage.escalateTo ?? "a human";
    return `${stage.id} attempts ${attempts} exceed retry limit ${stage.retryLimit}. Escalate to ${target}.`;
  }
  return null;
}
