import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createJob, fetchSettings, fetchTtsVoices, previewTtsVoice, toAbsoluteOutputUrl } from "../api";
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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
      setVoicePreviewUrl(`${toAbsoluteOutputUrl(preview.previewPath)}?t=${Date.now()}`);
      setVoiceMessage("Preview suara berhasil dibuat.");
    } catch (previewError) {
      setVoiceError((previewError as Error).message);
    } finally {
      setPreviewingVoice(false);
    }
  };

  const isGenerateDisabled =
    loading ||
    voiceLoading ||
    !video ||
    !selectedStyleId ||
    !selectedVoiceName ||
    !title.trim() ||
    !description.trim() ||
    !affiliateLink.trim();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!selectedStyleId) {
      setError("Pilih style video terlebih dahulu.");
      return;
    }
    if (!video) {
      setError("Video upload wajib diisi.");
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
    if (!title.trim() || !description.trim() || !affiliateLink.trim()) {
      setError("Judul, deskripsi, dan affiliate link wajib diisi.");
      return;
    }

    setLoading(true);
    try {
      const result = await createJob({
        sourceType: "upload",
        video,
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
      <h2>Generate (Upload Only)</h2>
      <p className="small">
        Editing video dihapus. Seluruh konfigurasi generate langsung ditampilkan di halaman utama.
      </p>
      <form onSubmit={onSubmit} className="grid-form">
        <label>
          Upload Video
          <input
            id="video-input"
            type="file"
            accept="video/*"
            onChange={(event) => setVideo(event.target.files?.[0] || null)}
          />
        </label>

        <fieldset className="style-picker">
          <legend>Style Video</legend>
          {settingsLoading && <p className="small">Memuat style...</p>}
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
          {!voiceLoading && !ttsVoices.length && (
            <p className="err-inline">Katalog voice tidak tersedia.</p>
          )}
          {!voiceLoading && ttsVoices.length > 0 && (
            <>
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
    </section>
  );
}
