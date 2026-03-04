import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createJob,
  fetchSettings,
  fetchTtsVoices,
  previewTtsVoice,
  toAbsoluteOutputUrl
} from "../api";
import type {
  AppSettings,
  ExcitedVoicePreset,
  StyleId,
  TtsVoiceOption,
  VoiceGender
} from "../types";

const STYLE_TITLE: Record<StyleId, string> = {
  evergreen: "Evergreen",
  soft_selling: "Soft Selling",
  hard_selling: "Hard Selling",
  problem_solution: "Edukasi Problem-Solution"
};

export function GeneratePage() {
  const [video, setVideo] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [affiliateLink, setAffiliateLink] = useState("");
  const [enabledStyles, setEnabledStyles] = useState<AppSettings["styles"]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<StyleId | "">("");
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [ttsVoices, setTtsVoices] = useState<TtsVoiceOption[]>([]);
  const [excitedPresets, setExcitedPresets] = useState<ExcitedVoicePreset[]>([]);
  const [voiceLoading, setVoiceLoading] = useState(true);
  const [voiceCatalogError, setVoiceCatalogError] = useState("");
  const [voiceMode, setVoiceMode] = useState<"normal" | "excited">("excited");
  const [selectedVoiceGender, setSelectedVoiceGender] = useState<VoiceGender>("female");
  const [selectedExcitedPresetId, setSelectedExcitedPresetId] = useState("");
  const [selectedVoiceName, setSelectedVoiceName] = useState("");
  const [selectedSpeechRate, setSelectedSpeechRate] = useState(1);

  const [previewText, setPreviewText] = useState(
    "Ini contoh voice over untuk video affiliate. Cek detail produk di komentar dan deskripsi."
  );
  const [voicePreviewUrl, setVoicePreviewUrl] = useState("");
  const [voiceMessage, setVoiceMessage] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [previewingVoice, setPreviewingVoice] = useState(false);

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

        const voices = Array.isArray(voiceData.voices) ? voiceData.voices : [];
        const presets = Array.isArray(voiceData.excitedPresets) ? voiceData.excitedPresets : [];
        setTtsVoices(voices);
        setExcitedPresets(presets);

        const femalePreset = presets.find((preset) => preset.gender === "female");
        if (femalePreset) {
          setSelectedVoiceGender("female");
          setSelectedExcitedPresetId(femalePreset.presetId);
          setSelectedVoiceName(femalePreset.voiceName);
        } else if (voices[0]) {
          setSelectedVoiceName(voices[0].voiceName);
          setSelectedVoiceGender(voices[0].gender);
        }

        setVoiceCatalogError("");
      })
      .catch((loadError) => {
        if (!mounted) {
          return;
        }
        setError((loadError as Error).message);
        setVoiceCatalogError((loadError as Error).message);
      })
      .finally(() => {
        if (mounted) {
          setSettingsLoading(false);
          setVoiceLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const voicesByGender = useMemo(() => {
    const filtered = ttsVoices.filter((voice) => voice.gender === selectedVoiceGender);
    return filtered.length ? filtered : ttsVoices;
  }, [ttsVoices, selectedVoiceGender]);

  const excitedByGender = useMemo(
    () => excitedPresets.filter((preset) => preset.gender === selectedVoiceGender),
    [excitedPresets, selectedVoiceGender]
  );

  useEffect(() => {
    if (!ttsVoices.length || selectedVoiceName) {
      return;
    }

    const firstPreset = excitedByGender[0];
    if (voiceMode === "excited" && firstPreset) {
      setSelectedExcitedPresetId(firstPreset.presetId);
      setSelectedVoiceName(firstPreset.voiceName);
      return;
    }
    if (voicesByGender[0]) {
      setSelectedVoiceName(voicesByGender[0].voiceName);
    }
  }, [excitedByGender, selectedVoiceName, ttsVoices, voiceMode, voicesByGender]);

  const onVoiceGenderChange = (gender: VoiceGender) => {
    setSelectedVoiceGender(gender);
    if (voiceMode !== "excited") {
      return;
    }
    const firstPreset = excitedPresets.find((preset) => preset.gender === gender);
    if (firstPreset) {
      setSelectedExcitedPresetId(firstPreset.presetId);
      setSelectedVoiceName(firstPreset.voiceName);
      return;
    }
    const firstVoice = ttsVoices.find((voice) => voice.gender === gender);
    if (firstVoice) {
      setSelectedVoiceName(firstVoice.voiceName);
      setSelectedExcitedPresetId("");
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
      setVoicePreviewUrl(`${toAbsoluteOutputUrl(preview.previewPath)}?t=${Date.now()}`);
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
    setVoiceMessage("");
    setVoiceError("");
    if (!selectedStyleId) {
      setError("Pilih satu style video terlebih dahulu.");
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
    if (!video || !title.trim() || !description.trim() || !affiliateLink.trim()) {
      setError("Video, judul, deskripsi, affiliate link, voice, dan style wajib diisi.");
      return;
    }

    setLoading(true);
    try {
      const result = await createJob({
        video,
        voiceName: selectedVoiceName,
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
      setVideo(null);
      const fileInput = document.getElementById("video-input") as HTMLInputElement | null;
      if (fileInput) {
        fileInput.value = "";
      }
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card">
      <h2>Generate</h2>
      <p>Input video, pilih satu style, lalu generate.</p>
      <form onSubmit={onSubmit} className="grid-form">
        <label>
          Video
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
          <legend>TTS Voice</legend>
          {voiceLoading && <p className="small">Memuat katalog voice Gemini...</p>}
          {!voiceLoading && voiceCatalogError && (
            <p className="err-inline">Gagal memuat katalog voice: {voiceCatalogError}</p>
          )}
          {!voiceLoading && !voiceCatalogError && ttsVoices.length > 0 && (
            <>
              <label>
                Mode
                <select
                  value={voiceMode}
                  onChange={(event) => setVoiceMode(event.target.value as "normal" | "excited")}
                >
                  <option value="excited">Excited</option>
                  <option value="normal">Normal</option>
                </select>
              </label>
              <label>
                Gender
                <select
                  value={selectedVoiceGender}
                  onChange={(event) => onVoiceGenderChange(event.target.value as VoiceGender)}
                >
                  <option value="female">Wanita</option>
                  <option value="male">Pria</option>
                  <option value="neutral">Netral</option>
                </select>
              </label>
              {voiceMode === "excited" && (
                <label>
                  Versi Excited
                  <select
                    value={selectedExcitedPresetId}
                    onChange={(event) => onExcitedPresetChange(event.target.value)}
                  >
                    <option value="">Custom (pilih voice manual)</option>
                    {excitedByGender.map((preset) => (
                      <option key={preset.presetId} value={preset.presetId}>
                        {preset.label} ({preset.voiceName})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Voice
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
                      {voice.label} - {voice.tone} ({voice.gender})
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
              <label>
                Teks Preview
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
                {previewingVoice ? "Membuat preview..." : "Preview Suara"}
              </button>
              {voicePreviewUrl && <audio controls src={voicePreviewUrl} />}
              {voiceMessage && <p className="ok-text">{voiceMessage}</p>}
              {voiceError && <p className="err-text">{voiceError}</p>}
            </>
          )}
          {!voiceLoading && !voiceCatalogError && !ttsVoices.length && (
            <p className="err-inline">Katalog voice kosong dari backend.</p>
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
        <button type="submit" disabled={loading}>
          {loading ? "Memproses..." : "Generate Job"}
        </button>
      </form>
      {message && <p className="ok-text">{message}</p>}
      {error && <p className="err-text">{error}</p>}
    </section>
  );
}
