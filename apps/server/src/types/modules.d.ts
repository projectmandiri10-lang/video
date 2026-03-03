declare module "@fastify/static" {
  import type { FastifyPluginAsync } from "fastify";
  const plugin: FastifyPluginAsync<Record<string, unknown>>;
  export default plugin;
}

declare module "ffprobe-static" {
  const ffprobe: { path: string };
  export default ffprobe;
}

declare module "ffmpeg-static" {
  const ffmpeg: string;
  export default ffmpeg;
}

declare module "@google/genai/node" {
  interface GeminiFile {
    name?: string;
    uri?: string;
    mimeType?: string;
    state?: "STATE_UNSPECIFIED" | "PROCESSING" | "ACTIVE" | "FAILED";
    error?: {
      message?: string;
      code?: number;
    };
  }

  export class GoogleGenAI {
    public constructor(config: { apiKey: string });
    public files: {
      upload(input: {
        file: string;
        config?: { mimeType?: string };
      }): Promise<GeminiFile>;
      get(input: { name: string }): Promise<GeminiFile>;
    };
    public models: {
      generateContent(input: unknown): Promise<unknown>;
    };
  }
}
