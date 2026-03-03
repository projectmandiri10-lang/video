import { useEffect, useMemo, useState } from "react";
import {
  deleteJob,
  fetchJobDetail,
  fetchJobs,
  openStyleOutputLocation,
  retryStyle
} from "../api";
import { StatusBadge } from "../components/StatusBadge";
import type { JobRecord, StyleId } from "../types";

const STYLE_LABEL: Record<StyleId, string> = {
  evergreen: "Evergreen",
  soft_selling: "Soft Selling",
  hard_selling: "Hard Selling",
  problem_solution: "Problem-Solution"
};

export function JobsPage() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copyInfo, setCopyInfo] = useState("");
  const [openingKey, setOpeningKey] = useState("");
  const [deletingJobId, setDeletingJobId] = useState("");

  const refreshJobs = async () => {
    try {
      setLoading(true);
      const list = await fetchJobs();
      setJobs(list);
      const firstJob = list[0];
      if (!firstJob) {
        setSelectedJobId("");
        setSelectedJob(null);
      } else if (!selectedJobId || !list.some((item) => item.jobId === selectedJobId)) {
        setSelectedJobId(firstJob.jobId);
      }
      setError("");
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const refreshDetail = async (jobId: string) => {
    try {
      const detail = await fetchJobDetail(jobId);
      setSelectedJob(detail);
      setError("");
    } catch (loadError) {
      const message = (loadError as Error).message;
      if (message.includes("tidak ditemukan") || message.includes("HTTP 404")) {
        setSelectedJob(null);
        const firstJob = jobs[0];
        setSelectedJobId(firstJob?.jobId || "");
        return;
      }
      setError(message);
    }
  };

  useEffect(() => {
    void refreshJobs();
  }, []);

  useEffect(() => {
    if (!selectedJobId) {
      return;
    }
    void refreshDetail(selectedJobId);
    const timer = setInterval(() => {
      void refreshDetail(selectedJobId);
      void refreshJobs();
    }, 5000);
    return () => clearInterval(timer);
  }, [selectedJobId]);

  const selected = useMemo(
    () => selectedJob ?? jobs.find((item) => item.jobId === selectedJobId) ?? null,
    [jobs, selectedJob, selectedJobId]
  );

  const onRetry = async (styleId: StyleId) => {
    if (!selected) {
      return;
    }
    try {
      await retryStyle(selected.jobId, styleId);
      await refreshDetail(selected.jobId);
      await refreshJobs();
    } catch (retryError) {
      setError((retryError as Error).message);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyInfo("Teks berhasil disalin.");
      setTimeout(() => setCopyInfo(""), 2000);
    } catch (copyError) {
      setError((copyError as Error).message);
    }
  };

  const openLocation = async (jobId: string, styleId: StyleId) => {
    const key = `${jobId}:${styleId}`;
    try {
      setOpeningKey(key);
      await openStyleOutputLocation(jobId, styleId);
    } catch (openError) {
      setError((openError as Error).message);
    } finally {
      setOpeningKey("");
    }
  };

  const isDeleteBlocked = (job: JobRecord): boolean =>
    job.overallStatus === "running" || job.overallStatus === "queued";

  const formatRetryTime = (iso: string): string => {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
      return iso;
    }
    return parsed.toLocaleTimeString("id-ID", { hour12: false });
  };

  const onDeleteJob = async (job: JobRecord) => {
    if (isDeleteBlocked(job) || deletingJobId) {
      return;
    }
    const confirmed = window.confirm("Hapus job ini beserta file output/upload?");
    if (!confirmed) {
      return;
    }

    try {
      setDeletingJobId(job.jobId);
      await deleteJob(job.jobId);
      const latestJobs = await fetchJobs();
      setJobs(latestJobs);

      if (selectedJobId === job.jobId) {
        const nextSelectedId = latestJobs[0]?.jobId || "";
        setSelectedJobId(nextSelectedId);
        if (nextSelectedId) {
          const nextDetail = await fetchJobDetail(nextSelectedId);
          setSelectedJob(nextDetail);
        } else {
          setSelectedJob(null);
        }
      } else if (selectedJobId) {
        const nextDetail = await fetchJobDetail(selectedJobId);
        setSelectedJob(nextDetail);
      }
      setError("");
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setDeletingJobId("");
    }
  };

  const outputLabels = (style: JobRecord["styles"][number]): string[] => {
    const labels: string[] = [];
    if (style.srtPath) {
      labels.push("SRT");
    }
    if (style.wavPath) {
      labels.push("WAV");
    }
    if (style.mp4Path) {
      labels.push("MP4");
    }
    if (style.captionPath) {
      labels.push("Caption TXT");
    }
    return labels;
  };

  const composeCaptionForCopy = (
    style: JobRecord["styles"][number],
    jobAffiliateLink?: string
  ): string => {
    const blocks = [
      style.captionText ?? "",
      style.hashtags?.join(" ") ?? "",
      jobAffiliateLink?.trim() ?? ""
    ].filter((value) => value.length > 0);
    return blocks.join("\n\n");
  };

  return (
    <section className="card split-layout">
      <div>
        <div className="row-head">
          <h2>Jobs</h2>
          <button onClick={refreshJobs} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className="job-list">
          {jobs.map((job) => (
            <div
              key={job.jobId}
              className={`job-item-wrap ${job.jobId === selectedJobId ? "active" : ""}`}
            >
              <button
                className="job-item"
                onClick={() => {
                  setSelectedJobId(job.jobId);
                  void refreshDetail(job.jobId);
                }}
              >
                <div>{job.title}</div>
                <div className="small">#{job.jobId}</div>
                <StatusBadge status={job.overallStatus} />
              </button>
              <button
                className="danger-btn"
                disabled={isDeleteBlocked(job) || deletingJobId === job.jobId}
                onClick={() => void onDeleteJob(job)}
              >
                {deletingJobId === job.jobId ? "Deleting..." : "Delete"}
              </button>
            </div>
          ))}
          {!jobs.length && <p>Belum ada job.</p>}
        </div>
      </div>
      <div>
        <div className="row-head">
          <h3>Detail Job</h3>
          {selected && (
            <button
              className="danger-btn"
              disabled={isDeleteBlocked(selected) || deletingJobId === selected.jobId}
              onClick={() => void onDeleteJob(selected)}
            >
              {deletingJobId === selected.jobId ? "Deleting..." : "Delete Job"}
            </button>
          )}
        </div>
        {!selected && <p>Pilih job untuk melihat detail.</p>}
        {selected && (
          <div className="detail-box">
            <p>
              <strong>Judul:</strong> {selected.title}
            </p>
            <p>
              <strong>Durasi:</strong> {selected.videoDurationSec.toFixed(2)} detik
            </p>
            <p>
              <strong>Status:</strong> <StatusBadge status={selected.overallStatus} />
            </p>
            <p>
              <strong>Source:</strong> {selected.sourceType === "editing" ? "Editing" : "Upload"}
              {selected.editSessionId ? ` (${selected.editSessionId})` : ""}
            </p>
            <p>
              <strong>Voice TTS:</strong>{" "}
              {selected.voiceName
                ? `${selected.voiceName} (${selected.voiceGender || "neutral"}, speed ${(
                    selected.speechRate ?? 1
                  ).toFixed(2)})`
                : "Default style"}
            </p>
            <p>
              <strong>Affiliate Link:</strong>{" "}
              {selected.affiliateLink ? (
                <span>{selected.affiliateLink}</span>
              ) : (
                <span className="small">Tidak tersedia</span>
              )}
            </p>
            {selected.affiliateLink && (
              <button onClick={() => void copyToClipboard(selected.affiliateLink || "")}>
                Copy Affiliate Link
              </button>
            )}
            <table>
              <thead>
                <tr>
                  <th>Style</th>
                  <th>Status</th>
                  <th>Output</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {selected.styles.map((style) => (
                  <tr key={style.styleId}>
                    <td>{STYLE_LABEL[style.styleId]}</td>
                    <td>
                      <StatusBadge status={style.status} />
                      {style.status === "pending" && style.nextRetryAt && (
                        <div className="small">
                          Auto retry #{style.retryCount ?? 0} pada {formatRetryTime(style.nextRetryAt)}
                        </div>
                      )}
                      {style.lastErrorCode && style.status !== "done" && (
                        <div className="small">Error code: {style.lastErrorCode}</div>
                      )}
                      {style.errorMessage && <div className="err-inline">{style.errorMessage}</div>}
                    </td>
                    <td>
                      <div className="small">
                        {outputLabels(style).length
                          ? `Tersedia: ${outputLabels(style).join(", ")}`
                          : "Belum ada file output"}
                      </div>
                      <button
                        onClick={() => void openLocation(selected.jobId, style.styleId)}
                        disabled={openingKey === `${selected.jobId}:${style.styleId}`}
                      >
                        {openingKey === `${selected.jobId}:${style.styleId}`
                          ? "Opening..."
                          : "Open File Location"}
                      </button>
                      {(style.captionText || style.hashtags?.length) && (
                        <div className="caption-box">
                          {style.captionText && <p>{style.captionText}</p>}
                          {style.hashtags?.length ? (
                            <p className="small">{style.hashtags.join(" ")}</p>
                          ) : null}
                          {selected.affiliateLink && (
                            <p className="small">{selected.affiliateLink}</p>
                          )}
                          <button
                            onClick={() =>
                              void copyToClipboard(
                                composeCaptionForCopy(style, selected.affiliateLink)
                              )
                            }
                          >
                            Copy Caption
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      {(style.status === "failed" || style.status === "interrupted") && (
                        <button onClick={() => void onRetry(style.styleId)}>Retry</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {copyInfo && <p className="ok-text">{copyInfo}</p>}
        {error && <p className="err-text">{error}</p>}
      </div>
    </section>
  );
}
