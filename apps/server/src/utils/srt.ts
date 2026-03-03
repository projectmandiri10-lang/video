interface CueDraft {
  text: string;
  lines: string[];
  words: number;
}

export interface TimedCue extends CueDraft {
  startMs: number;
  endMs: number;
}

const TARGET_LINE = 38;
const MAX_LINE = 42;
const MAX_BLOCK = 80;

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function countWords(input: string): number {
  const normalized = normalizeWhitespace(input);
  if (!normalized) {
    return 0;
  }
  return normalized.split(" ").length;
}

function chunkScript(script: string): string[] {
  const words = normalizeWhitespace(script).split(" ").filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= MAX_BLOCK) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
    }
    current = word;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function findNearestSplit(text: string, target: number): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 1; i < text.length - 1; i += 1) {
    if (text[i] !== " ") {
      continue;
    }
    const distance = Math.abs(i - target);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

function splitInHalf(text: string): [string, string] {
  const normalized = normalizeWhitespace(text);
  const splitIndex = findNearestSplit(normalized, Math.floor(normalized.length / 2));
  if (splitIndex < 0) {
    const middle = Math.floor(normalized.length / 2);
    return [normalized.slice(0, middle).trim(), normalized.slice(middle).trim()];
  }
  return [
    normalized.slice(0, splitIndex).trim(),
    normalized.slice(splitIndex + 1).trim()
  ];
}

function enforceCueCount(chunks: string[], totalDurationSec: number): string[] {
  const safeDuration = Math.max(1, Math.floor(totalDurationSec));
  const minCount = Math.max(1, Math.ceil(totalDurationSec / 4));
  const maxCount = Math.max(1, safeDuration);
  let next = [...chunks];

  while (next.length < minCount) {
    const index = next
      .map((text, i) => ({ i, len: text.length }))
      .sort((a, b) => b.len - a.len)[0]?.i;
    if (index === undefined) {
      break;
    }
    const selected = next[index];
    if (!selected) {
      break;
    }
    const [left, right] = splitInHalf(selected);
    if (!left || !right) {
      break;
    }
    next.splice(index, 1, left, right);
  }

  while (next.length > maxCount && next.length > 1) {
    const index = next
      .map((text, i) => ({ i, len: text.length }))
      .sort((a, b) => a.len - b.len)[0]?.i;
    if (index === undefined) {
      break;
    }
    const neighborIndex = index === 0 ? 1 : index - 1;
    const merged = `${next[neighborIndex] ?? ""} ${next[index] ?? ""}`.trim();
    next[neighborIndex] = merged;
    next.splice(index, 1);
  }

  return next;
}

function wrapTwoLines(text: string): string[] {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= MAX_LINE) {
    return [normalized];
  }

  const splitIndex = findNearestSplit(normalized, TARGET_LINE);
  if (splitIndex < 0) {
    return [
      normalized.slice(0, MAX_LINE).trim(),
      normalized.slice(MAX_LINE).trim()
    ].filter(Boolean);
  }

  const first = normalized.slice(0, splitIndex).trim();
  const second = normalized.slice(splitIndex + 1).trim();
  if (first.length <= MAX_LINE && second.length <= MAX_LINE) {
    return [first, second];
  }

  return [
    normalized.slice(0, MAX_LINE).trim(),
    normalized.slice(MAX_LINE).trim()
  ].filter(Boolean);
}

function createDrafts(script: string, totalDurationSec: number): CueDraft[] {
  const chunks = enforceCueCount(chunkScript(script), totalDurationSec);
  return chunks.map((chunk) => ({
    text: chunk,
    lines: wrapTwoLines(chunk).slice(0, 2),
    words: Math.max(1, countWords(chunk))
  }));
}

function distributeDurations(drafts: CueDraft[], totalDurationSec: number): number[] {
  const minDuration = 1;
  const maxDuration = 4;
  const totalWords = drafts.reduce((sum, draft) => sum + draft.words, 0);
  let durations = drafts.map((draft) => (totalDurationSec * draft.words) / totalWords);
  durations = durations.map((value) => Math.max(minDuration, Math.min(maxDuration, value)));

  let diff = totalDurationSec - durations.reduce((sum, value) => sum + value, 0);
  let guard = 0;
  while (Math.abs(diff) > 0.001 && guard < 5000) {
    guard += 1;
    if (diff > 0) {
      const expandable = durations
        .map((value, index) => ({ index, room: maxDuration - value }))
        .filter((item) => item.room > 0);
      if (expandable.length === 0) {
        break;
      }
      const roomSum = expandable.reduce((sum, item) => sum + item.room, 0);
      for (const item of expandable) {
        const add = Math.min(item.room, (diff * item.room) / roomSum);
        durations[item.index] = (durations[item.index] ?? minDuration) + add;
        diff -= add;
      }
    } else {
      const shrinkable = durations
        .map((value, index) => ({ index, room: value - minDuration }))
        .filter((item) => item.room > 0);
      if (shrinkable.length === 0) {
        break;
      }
      const roomSum = shrinkable.reduce((sum, item) => sum + item.room, 0);
      for (const item of shrinkable) {
        const remove = Math.min(item.room, (Math.abs(diff) * item.room) / roomSum);
        durations[item.index] = (durations[item.index] ?? minDuration) - remove;
        diff += remove;
      }
    }
  }

  if (Math.abs(diff) > 0.001) {
    const lastIndex = durations.length - 1;
    const current = durations[lastIndex] ?? minDuration;
    durations[durations.length - 1] = Math.max(
      minDuration,
      Math.min(maxDuration, current + diff)
    );
  }

  return durations;
}

export function buildTimedCues(script: string, totalDurationSec: number): TimedCue[] {
  const cleaned = normalizeWhitespace(script);
  if (!cleaned) {
    return [];
  }

  const drafts = createDrafts(cleaned, totalDurationSec);
  if (!drafts.length) {
    return [];
  }

  const durations = distributeDurations(drafts, totalDurationSec);
  let cursor = 0;
  return drafts.map((draft, index) => {
    const duration = (durations[index] ?? 1) * 1000;
    const startMs = Math.round(cursor);
    cursor += duration;
    const endMs =
      index === drafts.length - 1
        ? Math.round(totalDurationSec * 1000)
        : Math.round(cursor);
    return {
      ...draft,
      startMs,
      endMs
    };
  });
}

export function formatSrtTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1_000);
  const millis = totalMs % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function buildSrt(script: string, totalDurationSec: number): string {
  const cues = buildTimedCues(script, totalDurationSec);
  return cues
    .map((cue, index) => {
      const text = cue.lines.join("\n");
      return `${index + 1}\n${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(
        cue.endMs
      )}\n${text}\n`;
    })
    .join("\n");
}
