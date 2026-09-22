export interface Pipeline {
  version: number;
  name: string;
  artifactRoot: string;
  rootDir: string;
  orchestrator: {
    llm: boolean;
    routesBy: string;
  };
  separation: {
    specCriticMustDifferFrom: string;
    codeCriticMustDifferFrom: string;
  };
  roles: Record<string, Role>;
  humanGates: Record<string, HumanGate>;
  stages: Stage[];
}

export interface Role {
  title: string;
  folder: string;
  stages: string[];
}

export interface HumanGate {
  id: string;
  after: string;
  required: "true" | "conditional";
  condition?: string;
  whenVerdict?: string;
  resume: string;
  prompt: string;
}

export interface Stage {
  id: string;
  order: number;
  label: string;
  type: "agent";
  role: string;
  skill: string;
  retryLimit: number;
  separateSessionFrom?: string;
  requiresGate?: string;
  escalateTo?: string;
  inputs: Artifact[];
  outputs: Artifact[];
  onSuccess?: string;
  onReject?: string;
  onApprove?: string;
  onSendBack?: string;
  verdictValues?: string[];
}

export interface Artifact {
  name: string;
  path: string;
  required: boolean;
  source?: string;
  template?: string;
  requiredHeadings: string[];
  requiredFields: string[];
  contract: boolean;
  note?: string;
}

export interface RunManifest {
  featureId?: string;
  title?: string;
  sessions: Record<string, string>;
  gates: Record<string, string>;
  attempts: Record<string, number>;
}

export interface BriefMeta {
  openQuestions: string[];
}

export type NextAction =
  | {
      kind: "stage";
      stage: Stage;
      reason?: string;
      inputs: Array<{ path: string; present: boolean; contract: boolean }>;
      outputs: Array<{ path: string; present: boolean }>;
    }
  | {
      kind: "gate";
      gate: HumanGate;
    }
  | { kind: "blocked"; message: string }
  | { kind: "done" };

export interface RunStatus {
  featureId: string;
  title?: string;
  runDir: string;
  completed: string[];
  next: NextAction;
  errors: string[];
}
