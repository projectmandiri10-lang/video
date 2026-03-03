import { useEffect, useState, type FormEvent } from "react";
import { fetchSettings, updateSettings } from "../api";
import type { AppSettings, StyleConfig } from "../types";

const STYLE_TITLE: Record<StyleConfig["styleId"], string> = {
  evergreen: "Evergreen",
  soft_selling: "Soft Selling",
  hard_selling: "Hard Selling",
  problem_solution: "Edukasi Problem-Solution"
};

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSettings()
      .then(setSettings)
      .catch((loadError) => setError((loadError as Error).message));
  }, []);

  const onStyleChange = <K extends keyof StyleConfig>(
    styleId: StyleConfig["styleId"],
    key: K,
    value: StyleConfig[K]
  ) => {
    if (!settings) {
      return;
    }
    const styles = settings.styles.map((style) =>
      style.styleId === styleId ? { ...style, [key]: value } : style
    );
    setSettings({ ...settings, styles });
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings) {
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await updateSettings(settings);
      setSettings(saved);
      setMessage("Settings berhasil disimpan.");
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <section className="card">
        <h2>Settings</h2>
        <p>Memuat settings...</p>
        {error && <p className="err-text">{error}</p>}
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Settings</h2>
      <form className="grid-form" onSubmit={onSave}>
        <label>
          Script Model
          <input
            value={settings.scriptModel}
            onChange={(event) =>
              setSettings({ ...settings, scriptModel: event.target.value })
            }
          />
        </label>
        <label>
          TTS Model
          <input
            value={settings.ttsModel}
            onChange={(event) => setSettings({ ...settings, ttsModel: event.target.value })}
          />
        </label>
        <label>
          Max Video Seconds
          <input
            type="number"
            min={10}
            max={180}
            value={settings.maxVideoSeconds}
            onChange={(event) =>
              setSettings({ ...settings, maxVideoSeconds: Number(event.target.value) })
            }
          />
        </label>
        <div className="style-grid">
          {settings.styles.map((style) => (
            <article className="style-card" key={style.styleId}>
              <h3>{STYLE_TITLE[style.styleId]}</h3>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={style.enabled}
                  onChange={(event) =>
                    onStyleChange(style.styleId, "enabled", event.target.checked)
                  }
                />
                Aktif
              </label>
              <label>
                Prompt Template
                <textarea
                  rows={6}
                  value={style.promptTemplate}
                  onChange={(event) =>
                    onStyleChange(style.styleId, "promptTemplate", event.target.value)
                  }
                />
              </label>
              <p className="small">
                Tip: tulis arahan hook pembuka di kalimat pertama agar 1-2 detik awal lebih
                menarik.
              </p>
              <p className="small">
                Pengaturan voice dan speech rate sekarang dipilih di halaman Generate.
              </p>
            </article>
          ))}
        </div>
        <button type="submit" disabled={saving}>
          {saving ? "Menyimpan..." : "Simpan Settings"}
        </button>
      </form>
      {message && <p className="ok-text">{message}</p>}
      {error && <p className="err-text">{error}</p>}
    </section>
  );
}
