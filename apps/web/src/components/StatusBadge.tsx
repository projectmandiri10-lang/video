import type { JobOverallStatus, StyleStatus } from "../types";

const palette: Record<JobOverallStatus | StyleStatus, string> = {
  queued: "status status-queued",
  running: "status status-running",
  success: "status status-success",
  partial_success: "status status-partial",
  failed: "status status-failed",
  interrupted: "status status-interrupted",
  pending: "status status-queued",
  done: "status status-success"
};

export function StatusBadge({ status }: { status: JobOverallStatus | StyleStatus }) {
  return <span className={palette[status] || "status"}>{status}</span>;
}
