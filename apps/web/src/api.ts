import type {
  AppSettings,
  ExcitedVoicePreset,
  EditSessionRecord,
  EditTimelineItem,
  JobRecord,
  StyleId,
  TtsVoiceOption,
  VideoSourceType
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";
const BACKEND_OFFLINE_MESSAGE =
  "Backend tidak terhubung. Jalankan start-server.bat atau start-dev.bat, lalu refresh halaman.";

async function request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const message = (error as { message?: string })?.message || "";
    if (
      message.includes("Failed to fetch") ||
      message.includes("ERR_CONNECTION_REFUSED") ||
      message.includes("NetworkError")
    ) {
      throw new Error(BACKEND_OFFLINE_MESSAGE);
    }
    throw error;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.error ? `${body.message || "Error"}: ${body.error}` : body.message || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function fetchSettings(): Promise<AppSettings> {
  const res = await request(`${API_BASE}/api/settings`);
  return parseResponse<AppSettings>(res);
}

export async function updateSettings(settings: AppSettings): Promise<AppSettings> {
  const res = await request(`${API_BASE}/api/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(settings)
  });
  return parseResponse<AppSettings>(res);
}

export async function createJob(input: {
  sourceType: VideoSourceType;
  video?: File;
  editSessionId?: string;
  voiceName: string;
  voiceGender?: "female" | "male" | "neutral";
  speechRate: number;
  title: string;
  description: string;
  affiliateLink: string;
  styleId: StyleId;
}): Promise<{ jobId: string; status: string }> {
  const form = new FormData();
  if (input.video) {
    form.append("video", input.video);
  }
  if (input.editSessionId) {
    form.append("editSessionId", input.editSessionId);
  }
  form.append("voiceName", input.voiceName);
  if (input.voiceGender) {
    form.append("voiceGender", input.voiceGender);
  }
  form.append("speechRate", String(input.speechRate));
  form.append("sourceType", input.sourceType);
  form.append("title", input.title);
  form.append("description", input.description);
  form.append("affiliateLink", input.affiliateLink);
  form.append("styleId", input.styleId);
  const res = await request(`${API_BASE}/api/jobs`, {
    method: "POST",
    body: form
  });
  return parseResponse<{ jobId: string; status: string }>(res);
}

export async function fetchJobs(): Promise<JobRecord[]> {
  const res = await request(`${API_BASE}/api/jobs`);
  return parseResponse<JobRecord[]>(res);
}

export async function fetchJobDetail(jobId: string): Promise<JobRecord> {
  const res = await request(`${API_BASE}/api/jobs/${jobId}`);
  return parseResponse<JobRecord>(res);
}

export async function deleteJob(jobId: string): Promise<void> {
  const res = await request(`${API_BASE}/api/jobs/${jobId}`, {
    method: "DELETE"
  });
  await parseResponse<void>(res);
}

export async function retryStyle(jobId: string, styleId: StyleId): Promise<void> {
  const res = await request(`${API_BASE}/api/jobs/${jobId}/retry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ styleId })
  });
  await parseResponse<{ ok: boolean }>(res);
}

export async function fetchTtsVoices(): Promise<{
  voices: TtsVoiceOption[];
  excitedPresets: ExcitedVoicePreset[];
}> {
  const res = await request(`${API_BASE}/api/tts/voices`);
  return parseResponse<{
    voices: TtsVoiceOption[];
    excitedPresets: ExcitedVoicePreset[];
  }>(res);
}

export async function previewTtsVoice(input: {
  voiceName: string;
  speechRate: number;
  text?: string;
}): Promise<{ voiceName: string; previewPath: string }> {
  const res = await request(`${API_BASE}/api/tts/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return parseResponse<{ voiceName: string; previewPath: string }>(res);
}

export async function openStyleOutputLocation(
  jobId: string,
  styleId: StyleId
): Promise<void> {
  const res = await request(`${API_BASE}/api/jobs/${jobId}/open-location`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ styleId })
  });
  await parseResponse<{ ok: boolean }>(res);
}

export async function createEditorSession(): Promise<EditSessionRecord> {
  const res = await request(`${API_BASE}/api/editor/session`, {
    method: "POST"
  });
  return parseResponse<EditSessionRecord>(res);
}

export async function fetchEditorSession(sessionId: string): Promise<EditSessionRecord> {
  const res = await request(`${API_BASE}/api/editor/${sessionId}`);
  return parseResponse<EditSessionRecord>(res);
}

export async function deleteEditorSession(sessionId: string): Promise<void> {
  const res = await request(`${API_BASE}/api/editor/${sessionId}`, {
    method: "DELETE"
  });
  await parseResponse<void>(res);
}

export async function uploadEditorClips(
  sessionId: string,
  clips: File[]
): Promise<EditSessionRecord> {
  const form = new FormData();
  clips.forEach((clip, index) => {
    form.append(`clip_${index}`, clip);
  });
  const res = await request(`${API_BASE}/api/editor/${sessionId}/clips`, {
    method: "POST",
    body: form
  });
  return parseResponse<EditSessionRecord>(res);
}

export async function updateEditorTimeline(
  sessionId: string,
  timeline: EditTimelineItem[]
): Promise<EditSessionRecord> {
  const res = await request(`${API_BASE}/api/editor/${sessionId}/timeline`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ timeline })
  });
  return parseResponse<EditSessionRecord>(res);
}

export async function renderEditorPreview(sessionId: string): Promise<EditSessionRecord> {
  const res = await request(`${API_BASE}/api/editor/${sessionId}/render-preview`, {
    method: "POST"
  });
  return parseResponse<EditSessionRecord>(res);
}

export function toAbsoluteOutputUrl(relativePath: string): string {
  if (relativePath.startsWith("http://") || relativePath.startsWith("https://")) {
    return relativePath;
  }
  return `${API_BASE}${relativePath}`;
}
