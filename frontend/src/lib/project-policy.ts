import { annotationCredits, ServiceError } from "./credits";

export const PROJECT_POLICY_VERSION = "2026-11-11-v3";
export const STORAGE_BLOCK_BYTES = 100_000_000;
export const PROJECT_RATES = {
  upload: 1,
  outputSave: 1,
  download: 40,
  deletion: 1,
  storageMonthly: 5,
} as const;
export const FREE_PROJECT_LIMITS = {
  projects: 3,
  uploadFileBytes: 100_000_000,
  retainedBytes: 100_000_000,
  uploadBytesPerDay: 100_000_000,
  downloadBytesPerDay: 100_000_000,
  activeRuns: 1,
  expandedFileBytes: 1_000_000_000,
} as const;
export type FileOperation = keyof typeof PROJECT_RATES;
export function byteBlocks(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new ServiceError(400, "Invalid file size.");
  return Math.ceil(bytes / STORAGE_BLOCK_BYTES);
}
export function fileCharge(bytes: number, operation: FileOperation) {
  return byteBlocks(bytes) * PROJECT_RATES[operation];
}
export function projectRunCharge(variants: number) {
  if (!Number.isSafeInteger(variants) || variants < 1)
    throw new ServiceError(400, "Invalid variant count.");
  return annotationCredits(variants);
}
export function enforceFreeByteLimit(
  usedBytes: number,
  additionalBytes: number,
  limit: number,
) {
  byteBlocks(usedBytes);
  byteBlocks(additionalBytes);
  if (additionalBytes > limit || usedBytes > limit - additionalBytes)
    throw new ServiceError(403, "This operation exceeds your free account allowance.", "free_limit");
}
export type ProjectFile = {
  id: string;
  name: string;
  role: "input" | "output";
  status: "uploading" | "validating" | "ready" | "invalid" | "deleted";
  bytes: number;
  objectGeneration: string | null;
  objectPath: string;
  recordCount: number | null;
  variantCount: number | null;
  createdAt: number;
  deletedAt: number | null;
};
export type ProjectRun = {
  id: string;
  inputFileId: string;
  inputGeneration: string;
  status: "quoted" | "queued" | "preparing" | "annotating" | "compressing" | "saving" | "complete" | "failed" | "cancelled";
  processedVariants: number;
  totalVariants: number;
  annotationCredits: number;
  maxOutputSaveCredits: number;
  policyVersion: string;
  createdAt: number;
};
export function freeProjectExpiry(createdAt: number) {
  if (!Number.isFinite(createdAt)) throw new ServiceError(400, "Invalid creation date.");
  const date = new Date(createdAt);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}
export function projectExpiry(project: { createdAt: number; expiresAt?: number | null }, free: boolean) {
  return project.expiresAt === undefined ? (free ? freeProjectExpiry(project.createdAt) : null) : project.expiresAt;
}
export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
};
export function projectDetails(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ServiceError(400, "Provide project details.");
  const { name, description = "" } = input as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100)
    throw new ServiceError(400, "Use a project name between 1 and 100 characters.");
  if (typeof description !== "string" || description.length > 1000)
    throw new ServiceError(400, "Keep the description within 1,000 characters.");
  return { name: name.trim(), description: description.trim() };
}
