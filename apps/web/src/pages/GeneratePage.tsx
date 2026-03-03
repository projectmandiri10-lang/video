import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createEditorSession,
  createJob,
  deleteEditorSession,
  fetchSettings,
  renderEditorPreview,
  updateEditorTimeline,
  uploadEditorClips,
  toAbsoluteOutputUrl
} from "../api";
import type {
  AppSettings,
  EditSessionRecord,
  EditTimelineItem,
  StyleId,
  VideoSourceType
} from "../types";

const STYLE_TITLE: Record<StyleId, string> = {
  evergreen: "Evergreen",
  soft_selling: "Soft Selling",
  hard_selling: "Hard Selling",
  problem_solution: "Edukasi Problem-Solution"
};

const MIN_CLIP_SECONDS = 5;

function toFixedSeconds(value: number): number {
  return Number(value.toFixed(3));
}

function deriveTimelineDraft(
  session: EditSessionRecord,
  currentDraft: EditTimelineItem[]
): EditTimelineItem[] {
  if (session.timeline.length > 0) {
    return session.timeline.map((item) => ({ ...item }));
  }

  const clipsById = new Map(session.clips.map((clip) => [clip.clipId, clip]));
  const kept = currentDraft
    .filter((item) => clipsById.has(item.clipId))
    .map((item) => ({ ...item }));
  const keptIds = new Set(kept.map((item) => item.clipId));
  const appended = session.clips
    .filter((clip) => !keptIds.has(clip.clipId) && clip.durationSec >= MIN_CLIP_SECONDS)
    .map<EditTimelineItem>((clip) => ({
      clipId: clip.clipId,
      startSec: 0,
      endSec: toFixedSeconds(clip.durationSec)
    }));

  return [...kept, ...appended];
}

export function GeneratePage() {
  const [video, setVideo] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [affiliateLink, setAffiliateLink] = useState("");
  const [sourceType, setSourceType] = useState<VideoSourceType>("editing");
  const [enabledStyles, setEnabledStyles] = useState<AppSettings["styles"]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<StyleId | "">("");
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [editorSession, setEditorSession] = useState<EditSessionRecord | null>(null);
  const [timelineDraft, setTimelineDraft] = useState<EditTimelineItem[]>([]);
  const [editorLoading, setEditorLoading] = useState(true);
  const [uploadingClips, setUploadingClips] = useState(false);
  const [savingTimeline, setSavingTimeline] = useState(false);
  const [renderingPreview, setRenderingPreview] = useState(false);
  const [resettingEditor, setResettingEditor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [editorMessage, setEditorMessage] = useState<string>("");
  const [editorError, setEditorError] = useState<string>("");

  const initEditorSession = async (previousSessionId?: string) => {
    setEditorLoading(true);
    setEditorError("");
    setEditorMessage("");
    try {
      if (previousSessionId) {
        await deleteEditorSession(previousSessionId);
      }
    } catch {
      // Ignore cleanup errors and continue creating a fresh session.
    }

    try {
      const session = await createEditorSession();
      setEditorSession(session);
      setTimelineDraft(deriveTimelineDraft(session, []));
      setEditorMessage("Session editor siap dipakai.");
    } catch (initError) {
      setEditorError((initError as Error).message);
      setEditorSession(null);
      setTimelineDraft([]);
    } finally {
      setEditorLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    fetchSettings()
      .then((settings) => {
        if (!mounted) {
          return;
        }
        const activeStyles = settings.styles.filter((style) => style.enabled);
        setEnabledStyles(activeStyles);
        setSelectedStyleId((current) => {
          if (current && activeStyles.some((style) => style.styleId === current)) {
            return current;
          }
          return activeStyles[0]?.styleId ?? "";
        });
      })
      .catch((loadError) => {
        if (!mounted) {
          return;
        }
        setError((loadError as Error).message);
      })
      .finally(() => {
        if (mounted) {
          setSettingsLoading(false);
        }
      });

    void initEditorSession();
    return () => {
      mounted = false;
    };
  }, []);

  const clipsById = useMemo(
    () => new Map(editorSession?.clips.map((clip) => [clip.clipId, clip]) || []),
    [editorSession?.clips]
  );

  const previewUrl = editorSession?.previewPublicPath
    ? toAbsoluteOutputUrl(editorSession.previewPublicPath)
    : "";
  const hasPreview = Boolean(editorSession?.previewPublicPath);
  const shortClipsCount =
    editorSession?.clips.filter((clip) => clip.durationSec < MIN_CLIP_SECONDS).length || 0;

  const canGenerateFromUpload = Boolean(video);
  const canGenerateFromEditing = Boolean(editorSession?.sessionId && hasPreview);

  const isGenerateDisabled =
    loading ||
    !selectedStyleId ||
    !title.trim() ||
    !description.trim() ||
    !affiliateLink.trim() ||
    (sourceType === "upload" ? !canGenerateFromUpload : !canGenerateFromEditing);

  const persistTimeline = async (): Promise<EditSessionRecord | null> => {
    if (!editorSession) {
      setEditorError("Session editor belum tersedia.");
      return null;
    }
    if (!timelineDraft.length) {
      setEditorError("Timeline kosong. Tambahkan clip minimal 5 detik.");
      return null;
    }

    setSavingTimeline(true);
    setEditorError("");
    try {
      const updated = await updateEditorTimeline(editorSession.sessionId, timelineDraft);
      setEditorSession(updated);
      setTimelineDraft(deriveTimelineDraft(updated, timelineDraft));
      setEditorMessage("Timeline tersimpan.");
      return updated;
    } catch (saveError) {
      setEditorError((saveError as Error).message);
      return null;
    } finally {
      setSavingTimeline(false);
    }
  };

  const handleUploadClips = async (files: File[]) => {
    if (!editorSession) {
      setEditorError("Session editor belum tersedia.");
      return;
    }
    if (!files.length) {
      return;
    }

    setUploadingClips(true);
    setEditorError("");
    setEditorMessage("");
    try {
      const updated = await uploadEditorClips(editorSession.sessionId, files);
      setEditorSession(updated);
      setTimelineDraft((current) => deriveTimelineDraft(updated, current));
      setEditorMessage(`Berhasil upload ${files.length} clip.`);
    } catch (uploadError) {
      setEditorError((uploadError as Error).message);
    } finally {
      setUploadingClips(false);
    }
  };

  const onTimelineValueChange = (
    index: number,
    key: "startSec" | "endSec",
    value: number
  ) => {
    setTimelineDraft((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }
        const clip = clipsById.get(item.clipId);
        if (!clip) {
          return item;
        }
        const duration = clip.durationSec;
        const rawValue = Number.isFinite(value) ? value : 0;
        const clamped = Math.max(0, Math.min(rawValue, duration));
        const next = {
          ...item,
          [key]: toFixedSeconds(clamped)
        };
        if (key === "startSec" && next.startSec > next.endSec) {
          next.endSec = next.startSec;
        }
        if (key === "endSec" && next.endSec < next.startSec) {
          next.startSec = next.endSec;
        }
        return next;
      })
    );
  };

  const moveTimelineItem = (index: number, direction: -1 | 1) => {
    setTimelineDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      const first = next[index];
      const second = next[target];
      if (!first || !second) {
        return current;
      }
      next[index] = second;
      next[target] = first;
      return next;
    });
  };

  const onRenderPreview = async () => {
    if (!editorSession) {
      setEditorError("Session editor belum tersedia.");
      return;
    }

    const saved = await persistTimeline();
    if (!saved) {
      return;
    }

    setRenderingPreview(true);
    setEditorError("");
    try {
      const rendered = await renderEditorPreview(saved.sessionId);
      setEditorSession(rendered);
      setTimelineDraft(deriveTimelineDraft(rendered, timelineDraft));
      setEditorMessage("Preview selesai dirender.");
    } catch (renderError) {
      setEditorError((renderError as Error).message);
    } finally {
      setRenderingPreview(false);
    }
  };

  const onResetEditor = async () => {
    setResettingEditor(true);
    try {
      await initEditorSession(editorSession?.sessionId);
    } finally {
      setResettingEditor(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!selectedStyleId) {
      setError("Pilih satu style video terlebih dahulu.");
      return;
    }

    if (!title.trim() || !description.trim() || !affiliateLink.trim()) {
      setError("Judul, deskripsi, affiliate link, dan style wajib diisi.");
      return;
    }

    if (sourceType === "upload" && !video) {
      setError("Mode Upload dipilih, file video wajib diisi.");
      return;
    }
    if (sourceType === "editing") {
      if (!editorSession?.sessionId) {
        setError("Session editor belum siap.");
        return;
      }
      if (!editorSession.previewPublicPath) {
        setError("Mode Editing dipilih, render preview dulu sebelum generate.");
        return;
      }
    }

    setLoading(true);
    try {
      const result = await createJob({
        sourceType,
        video: sourceType === "upload" ? video || undefined : undefined,
        editSessionId: sourceType === "editing" ? editorSession?.sessionId : undefined,
        title: title.trim(),
        description: description.trim(),
        affiliateLink: affiliateLink.trim(),
        styleId: selectedStyleId
      });
      setMessage(`Job ${result.jobId} dibuat dengan status ${result.status}.`);
      setTitle("");
      setDescription("");
      setAffiliateLink("");
      if (sourceType === "upload") {
        setVideo(null);
        const fileInput = document.getElementById("video-input") as HTMLInputElement | null;
        if (fileInput) {
          fileInput.value = "";
        }
      }
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card generate-layout">
      <div className="editor-panel">
        <div className="row-head">
          <h2>Video Editor</h2>
          <button type="button" onClick={onResetEditor} disabled={editorLoading || resettingEditor}>
            {resettingEditor ? "Resetting..." : "Reset Session"}
          </button>
        </div>
        <p className="small">Gabungkan multi-clip, trim per clip, render preview muted (tanpa audio asli).</p>
        <label>
          Tambah Clip
          <input
            type="file"
            accept="video/*"
            multiple
            disabled={editorLoading || uploadingClips || !editorSession}
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              void handleUploadClips(files);
              event.target.value = "";
            }}
          />
        </label>
        {shortClipsCount > 0 && (
          <p className="err-inline">
            Ada {shortClipsCount} clip berdurasi kurang dari {MIN_CLIP_SECONDS} detik. Clip ini tidak
            masuk timeline.
          </p>
        )}
        <div className="timeline-box">
          <div className="row-head">
            <h3>Timeline</h3>
            <div className="timeline-actions">
              <button
                type="button"
                onClick={() => void persistTimeline()}
                disabled={editorLoading || savingTimeline || !timelineDraft.length}
              >
                {savingTimeline ? "Menyimpan..." : "Simpan Timeline"}
              </button>
              <button
                type="button"
                onClick={() => void onRenderPreview()}
                disabled={
                  editorLoading || renderingPreview || savingTimeline || !timelineDraft.length
                }
              >
                {renderingPreview ? "Rendering..." : "Render Preview"}
              </button>
            </div>
          </div>
          {!timelineDraft.length && (
            <p className="small">Belum ada item timeline. Upload clip minimal {MIN_CLIP_SECONDS} detik.</p>
          )}
          {timelineDraft.length > 0 && (
            <table className="timeline-table">
              <thead>
                <tr>
                  <th>Clip</th>
                  <th>Start (s)</th>
                  <th>End (s)</th>
                  <th>Durasi</th>
                  <th>Urutan</th>
                </tr>
              </thead>
              <tbody>
                {timelineDraft.map((item, index) => {
                  const clip = clipsById.get(item.clipId);
                  const clipName = clip?.originalName || item.clipId;
                  const duration = Math.max(0, item.endSec - item.startSec);
                  return (
                    <tr key={`${item.clipId}-${index}`}>
                      <td>
                        <div>{clipName}</div>
                        <div className="small">
                          Source: {clip ? clip.durationSec.toFixed(2) : "0.00"}s
                        </div>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={item.startSec}
                          onChange={(event) =>
                            onTimelineValueChange(index, "startSec", Number(event.target.value))
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={item.endSec}
                          onChange={(event) =>
                            onTimelineValueChange(index, "endSec", Number(event.target.value))
                          }
                        />
                      </td>
                      <td>
                        <span className={duration < MIN_CLIP_SECONDS ? "err-inline" : "small"}>
                          {duration.toFixed(2)}s
                        </span>
                      </td>
                      <td className="timeline-order">
                        <button type="button" onClick={() => moveTimelineItem(index, -1)}>
                          Up
                        </button>
                        <button type="button" onClick={() => moveTimelineItem(index, 1)}>
                          Down
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {hasPreview && (
          <div className="preview-box">
            <h3>Preview Hasil Editing</h3>
            <video controls src={previewUrl} className="preview-video" />
            {editorSession?.previewDurationSec ? (
              <p className="small">Durasi preview: {editorSession.previewDurationSec.toFixed(2)} detik</p>
            ) : null}
          </div>
        )}
        {editorMessage && <p className="ok-text">{editorMessage}</p>}
        {editorError && <p className="err-text">{editorError}</p>}
      </div>

      <div>
        <h2>Generate</h2>
        <p className="small">Pilih source video dari hasil editing atau upload langsung.</p>
        <form onSubmit={onSubmit} className="grid-form">
          <fieldset className="style-picker">
            <legend>Source Video</legend>
            <div className="source-options">
              <label className="style-option">
                <input
                  type="radio"
                  name="sourceType"
                  value="editing"
                  checked={sourceType === "editing"}
                  onChange={() => setSourceType("editing")}
                />
                <span>Gunakan hasil editing</span>
              </label>
              <label className="style-option">
                <input
                  type="radio"
                  name="sourceType"
                  value="upload"
                  checked={sourceType === "upload"}
                  onChange={() => setSourceType("upload")}
                />
                <span>Gunakan upload langsung</span>
              </label>
            </div>
            {sourceType === "editing" && !hasPreview && (
              <p className="err-inline">Preview editor belum ada. Klik Render Preview terlebih dahulu.</p>
            )}
            {sourceType === "upload" && !video && (
              <p className="err-inline">Pilih file upload jika source = upload.</p>
            )}
          </fieldset>

          <label>
            Upload Video (tetap tersedia)
            <input
              id="video-input"
              type="file"
              accept="video/*"
              onChange={(event) => setVideo(event.target.files?.[0] || null)}
            />
          </label>

          <fieldset className="style-picker">
            <legend>Style Video</legend>
            {settingsLoading && <p className="small">Memuat pilihan style...</p>}
            {!settingsLoading && !enabledStyles.length && (
              <p className="err-inline">Tidak ada style aktif. Aktifkan di halaman Settings.</p>
            )}
            {!settingsLoading && enabledStyles.length > 0 && (
              <div className="style-options">
                {enabledStyles.map((style) => (
                  <label key={style.styleId} className="style-option">
                    <input
                      type="radio"
                      name="styleId"
                      value={style.styleId}
                      checked={selectedStyleId === style.styleId}
                      onChange={() => setSelectedStyleId(style.styleId)}
                    />
                    <span>{STYLE_TITLE[style.styleId]}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <label>
            Judul
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            Deskripsi
            <textarea
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            Affiliate Link
            <input
              value={affiliateLink}
              placeholder="https://..."
              onChange={(event) => setAffiliateLink(event.target.value)}
            />
          </label>
          <button type="submit" disabled={isGenerateDisabled}>
            {loading ? "Memproses..." : "Generate Job"}
          </button>
        </form>
        {message && <p className="ok-text">{message}</p>}
        {error && <p className="err-text">{error}</p>}
      </div>
    </section>
  );
}
