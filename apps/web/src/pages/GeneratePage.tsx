import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createEditorSession,
  createJob,
  deleteEditorSession,
  fetchTtsVoices,
  fetchSettings,
  previewTtsVoice,
  renderEditorPreview,
  toAbsoluteOutputUrl,
  updateEditorTimeline,
  uploadEditorClips
} from "../api";
import type {
  AppSettings,
  ExcitedVoicePreset,
  EditSessionRecord,
  EditTimelineItem,
  StyleId,
  TtsVoiceOption,
  VideoSourceType,
  VoiceGender
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
  const [ttsVoices, setTtsVoices] = useState<TtsVoiceOption[]>([]);
  const [excitedPresets, setExcitedPresets] = useState<ExcitedVoicePreset[]>([]);
  const [voiceLoading, setVoiceLoading] = useState(true);
  const [selectedVoiceGender, setSelectedVoiceGender] = useState<VoiceGender>("female");
  const [selectedExcitedPresetId, setSelectedExcitedPresetId] = useState("");
  const [selectedVoiceName, setSelectedVoiceName] = useState("");
  const [selectedSpeechRate, setSelectedSpeechRate] = useState(1);
  const [previewText, setPreviewText] = useState(
    "Promo ini cocok buat kamu yang mau hasil cepat tapi tetap hemat."
  );
  const [voicePreviewUrl, setVoicePreviewUrl] = useState("");
  const [voiceMessage, setVoiceMessage] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [previewingVoice, setPreviewingVoice] = useState(false);

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
    Promise.all([fetchSettings(), fetchTtsVoices()])
      .then(([settings, voiceData]) => {
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

        setTtsVoices(voiceData.voices);
        setExcitedPresets(voiceData.excitedPresets);

        const defaultPreset = voiceData.excitedPresets.find(
          (preset) => preset.gender === "female"
        );
        if (defaultPreset) {
          setSelectedVoiceGender(defaultPreset.gender);
          setSelectedExcitedPresetId(defaultPreset.presetId);
          setSelectedVoiceName(defaultPreset.voiceName);
        } else if (voiceData.voices[0]) {
          setSelectedVoiceName(voiceData.voices[0].voiceName);
          setSelectedVoiceGender(voiceData.voices[0].gender);
        }
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
          setVoiceLoading(false);
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
  const voicesByGender = useMemo(() => {
    const filtered = ttsVoices.filter((voice) => voice.gender === selectedVoiceGender);
    return filtered.length ? filtered : ttsVoices;
  }, [ttsVoices, selectedVoiceGender]);
  const excitedByGender = useMemo(
    () => excitedPresets.filter((preset) => preset.gender === selectedVoiceGender),
    [excitedPresets, selectedVoiceGender]
  );
  const selectedVoice = useMemo(
    () => ttsVoices.find((voice) => voice.voiceName === selectedVoiceName),
    [ttsVoices, selectedVoiceName]
  );

  useEffect(() => {
    if (!ttsVoices.length) {
      return;
    }

    const isCurrentVoiceValid = voicesByGender.some(
      (voice) => voice.voiceName === selectedVoiceName
    );
    if (!isCurrentVoiceValid) {
      const preset = excitedByGender[0];
      if (preset) {
        setSelectedExcitedPresetId(preset.presetId);
        setSelectedVoiceName(preset.voiceName);
      } else if (voicesByGender[0]) {
        setSelectedVoiceName(voicesByGender[0].voiceName);
      }
    }
  }, [excitedByGender, selectedVoiceName, ttsVoices, voicesByGender]);

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
    voiceLoading ||
    !selectedStyleId ||
    !selectedVoiceName ||
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

  const onVoiceGenderChange = (gender: VoiceGender) => {
    setSelectedVoiceGender(gender);
    const firstPreset = excitedPresets.find((preset) => preset.gender === gender);
    if (firstPreset) {
      setSelectedExcitedPresetId(firstPreset.presetId);
      setSelectedVoiceName(firstPreset.voiceName);
      return;
    }
    const firstVoice = ttsVoices.find((voice) => voice.gender === gender);
    if (firstVoice) {
      setSelectedVoiceName(firstVoice.voiceName);
    }
  };

  const onExcitedPresetChange = (presetId: string) => {
    setSelectedExcitedPresetId(presetId);
    const preset = excitedPresets.find((item) => item.presetId === presetId);
    if (preset) {
      setSelectedVoiceName(preset.voiceName);
      setSelectedVoiceGender(preset.gender);
    }
  };

  const onReviewVoice = async () => {
    if (!selectedVoiceName) {
      setVoiceError("Pilih voice terlebih dahulu.");
      return;
    }
    setVoiceError("");
    setVoiceMessage("");
    setPreviewingVoice(true);
    try {
      const preview = await previewTtsVoice({
        voiceName: selectedVoiceName,
        speechRate: selectedSpeechRate,
        text: previewText.trim() || undefined
      });
      setVoicePreviewUrl(
        `${toAbsoluteOutputUrl(preview.previewPath)}?t=${Date.now().toString()}`
      );
      setVoiceMessage("Preview suara berhasil dibuat.");
    } catch (previewError) {
      setVoiceError((previewError as Error).message);
    } finally {
      setPreviewingVoice(false);
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
    if (!selectedVoiceName) {
      setError("Pilih voice over TTS terlebih dahulu.");
      return;
    }
    if (selectedSpeechRate < 0.7 || selectedSpeechRate > 1.3) {
      setError("Speech rate wajib di rentang 0.7 sampai 1.3.");
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
        voiceName: selectedVoiceName,
        voiceGender: selectedVoice?.gender || selectedVoiceGender,
        speechRate: selectedSpeechRate,
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
          <fieldset className="style-picker">
            <legend>TTS Voice Gemini</legend>
            {voiceLoading && <p className="small">Memuat katalog voice Gemini...</p>}
            {!voiceLoading && !ttsVoices.length && (
              <p className="err-inline">Katalog voice tidak tersedia.</p>
            )}
            {!voiceLoading && ttsVoices.length > 0 && (
              <>
                <div className="style-options">
                  <label>
                    Gender
                    <select
                      value={selectedVoiceGender}
                      onChange={(event) =>
                        onVoiceGenderChange(event.target.value as VoiceGender)
                      }
                    >
                      <option value="female">Wanita</option>
                      <option value="male">Pria</option>
                      <option value="neutral">Netral</option>
                    </select>
                  </label>
                  <label>
                    Versi Excited
                    <select
                      value={selectedExcitedPresetId}
                      onChange={(event) => onExcitedPresetChange(event.target.value)}
                    >
                      {!excitedByGender.length && <option value="">Tidak ada preset excited</option>}
                      {excitedByGender.map((preset) => (
                        <option key={preset.presetId} value={preset.presetId}>
                          {preset.label} ({preset.voiceName})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Nama Voice Over
                    <select
                      value={selectedVoiceName}
                      onChange={(event) => {
                        const nextVoice = event.target.value;
                        setSelectedVoiceName(nextVoice);
                        const matchedPreset = excitedByGender.find(
                          (preset) => preset.voiceName === nextVoice
                        );
                        setSelectedExcitedPresetId(matchedPreset?.presetId || "");
                      }}
                    >
                      {voicesByGender.map((voice) => (
                        <option key={voice.voiceName} value={voice.voiceName}>
                          {voice.label} - {voice.tone}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Speech Rate
                    <input
                      type="number"
                      min={0.7}
                      max={1.3}
                      step={0.05}
                      value={selectedSpeechRate}
                      onChange={(event) => setSelectedSpeechRate(Number(event.target.value))}
                    />
                  </label>
                </div>
                {selectedVoice && (
                  <p className="small">
                    Voice aktif: <strong>{selectedVoice.label}</strong> ({selectedVoice.gender}) -
                    tone {selectedVoice.tone}
                  </p>
                )}
                <label>
                  Teks Review Suara
                  <textarea
                    rows={2}
                    value={previewText}
                    onChange={(event) => setPreviewText(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void onReviewVoice()}
                  disabled={previewingVoice || !selectedVoiceName}
                >
                  {previewingVoice ? "Membuat preview..." : "Review Suara"}
                </button>
                {voicePreviewUrl && <audio controls src={voicePreviewUrl} />}
                {voiceMessage && <p className="ok-text">{voiceMessage}</p>}
                {voiceError && <p className="err-text">{voiceError}</p>}
              </>
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
