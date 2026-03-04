import { useEffect, useMemo, useState } from "react";
import {
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

  const refreshJobs = async () => {
    try {
      setLoading(true);
      const list = await fetchJobs();
      setJobs(list);
      const firstJob = list[0];
      if (!selectedJobId && firstJob) {
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
      setError((loadError as Error).message);
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
      setCopyInfo("Caption siap upload berhasil disalin.");
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
            <button
              key={job.jobId}
              className={`job-item ${job.jobId === selectedJobId ? "active" : ""}`}
              onClick={() => {
                setSelectedJobId(job.jobId);
                void refreshDetail(job.jobId);
              }}
            >
              <div>{job.title}</div>
              <div className="small">#{job.jobId}</div>
              <StatusBadge status={job.overallStatus} />
            </button>
          ))}
          {!jobs.length && <p>Belum ada job.</p>}
        </div>
      </div>
      <div>
        <h3>Detail Job</h3>
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
              <strong>Affiliate Link:</strong>{" "}
              {selected.affiliateLink ? (
                <span>{selected.affiliateLink}</span>
              ) : (
                <span className="small">Tidak tersedia</span>
              )}
            </p>
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
