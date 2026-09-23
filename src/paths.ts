import fs from "node:fs";
import path from "node:path";

/** `{run}/...` relative artifact path with no `..`, empty, or absolute segments. */
export function isSafeArtifactPath(artifactPath: string): boolean {
  if (!artifactPath.startsWith("{run}/")) {
    return false;
  }
  return isSafeRelative(artifactPath.slice("{run}/".length));
}

/** Relative path that cannot climb out of a root. Rejects absolutes and `..`. */
export function isSafeRelative(relativePath: string): boolean {
  if (relativePath.length === 0 || relativePath.includes("\0")) {
    return false;
  }
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    return false;
  }
  const parts = relativePath.split(/[\\/]/);
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function resolveArtifact(runDir: string, artifactPath: string): string {
  if (!isSafeArtifactPath(artifactPath)) {
    throw new Error(
      `Artifact path must stay under {run}/ and must not contain '..' or an absolute path: ${artifactPath}`,
    );
  }
  const relative = artifactPath.slice("{run}/".length);
  const root = path.resolve(runDir);
  const resolved = path.resolve(root, relative);
  assertInsideRoot(root, resolved, artifactPath);
  return resolved;
}

export function resolveRepoPath(rootDir: string, relativePath: string, label: string): string {
  if (!isSafeRelative(relativePath)) {
    throw new Error(`${label} must be a relative path inside the repo without '..': ${relativePath}`);
  }
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, relativePath);
  assertInsideRoot(root, resolved, label);
  return resolved;
}

/**
 * `confluence fetch --out` may only write under `<repo>/runs`.
 * The argument must be relative (`runs/...`), with no `..` and no absolute path.
 */
export function assertUnderRuns(repoRoot: string, outDir: string): string {
  if (path.isAbsolute(outDir)) {
    throw new Error("confluence fetch --out must be a relative path under runs/");
  }
  const normalized = outDir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized !== "runs" && !normalized.startsWith("runs/")) {
    throw new Error("confluence fetch --out must stay under runs/");
  }
  if (!isSafeRelative(normalized)) {
    throw new Error("confluence fetch --out must not contain '..'");
  }
  const runsRoot = path.resolve(repoRoot, "runs");
  const resolved = path.resolve(repoRoot, normalized);
  assertInsideRoot(runsRoot, resolved, "confluence fetch --out");
  return resolved;
}

export function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function assertInsideRoot(root: string, candidate: string, label: string): void {
  const rootReal = existingRealpath(path.resolve(root));
  const candidateReal = existingRealpath(path.resolve(candidate));
  const relative = path.relative(rootReal, candidateReal);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the allowed root ${path.resolve(root)}`);
  }
}

/** True when `target` is a file or directory inside `<repo>/examples`. */
export function isUnderExamples(repoRoot: string, target: string): boolean {
  const examples = path.resolve(repoRoot, "examples");
  const resolved = path.resolve(target);
  if (resolved === examples) {
    return false;
  }
  return isInsideRoot(examples, resolved);
}

function existingRealpath(target: string): string {
  const suffix: string[] = [];
  let current = target;
  const seen = new Set<string>();
  while (!fs.existsSync(current)) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    suffix.push(path.basename(current));
    current = parent;
  }
  const real = fs.existsSync(current) ? fs.realpathSync(current) : current;
  return suffix.length === 0 ? real : path.join(real, ...suffix.reverse());
}
