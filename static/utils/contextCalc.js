/**
 * @typedef {Object} ContextCategories
 * @property {number} systemPrompt
 * @property {number} systemTools
 * @property {number} customAgents
 * @property {number} skills
 * @property {number} messages
 * @property {number} autocompactBuffer
 */

/**
 * @typedef {Object} ContextInput
 * @property {string} modelName
 * @property {number} maxTokens
 * @property {ContextCategories} categories
 */

/**
 * @typedef {Object} CategorySlice
 * @property {string} key
 * @property {string} label
 * @property {number} tokens
 * @property {number} percent
 */

/**
 * @typedef {Object} ContextSnapshot
 * @property {string} modelName
 * @property {number} maxTokens
 * @property {number} blockTokens
 * @property {number} totalBlocks
 * @property {string[]} grid
 * @property {CategorySlice[]} breakdown
 * @property {number} freeTokens
 * @property {number} freePercent
 * @property {number} usedTokens
 * @property {number} usedPercent
 */

/** @type {Record<string, {label: string}>} */
export const CATEGORY_META = {
  systemPrompt: { label: "System prompt" },
  systemTools: { label: "System tools" },
  customAgents: { label: "Custom agents" },
  skills: { label: "Skills" },
  messages: { label: "Messages" },
  free: { label: "Free space" },
  autocompactBuffer: { label: "Autocompact buffer" },
};

/** Fixed visual order (left → right in the window). */
export const CATEGORY_ORDER = [
  "systemPrompt",
  "systemTools",
  "customAgents",
  "skills",
  "messages",
  "free",
  "autocompactBuffer",
];

const TARGET_BLOCKS = 56;

/**
 * Reserved tail buffer — 5% of window, clamped [512, 4096].
 * @param {number} maxTokens
 */
export function calcAutocompactBuffer(maxTokens) {
  return Math.min(4096, Math.max(512, Math.floor(maxTokens * 0.05)));
}

/**
 * @param {number} value
 * @param {number} max
 */
function clampNonNeg(value, max) {
  return Math.max(0, Math.min(value, max));
}

/**
 * Largest-remainder method — integer percents sum to exactly 100.
 * @param {Array<{key: string, tokens: number}>} parts
 * @param {number} maxTokens
 */
function integerPercents(parts, maxTokens) {
  if (maxTokens <= 0) return Object.fromEntries(parts.map((p) => [p.key, 0]));

  const raw = parts.map((p) => ({
    key: p.key,
    floor: Math.floor((p.tokens / maxTokens) * 100),
    rem: (p.tokens / maxTokens) * 100 - Math.floor((p.tokens / maxTokens) * 100),
  }));

  let assigned = raw.reduce((s, r) => s + r.floor, 0);
  const sorted = [...raw].sort((a, b) => b.rem - a.rem);
  let i = 0;
  while (assigned < 100 && i < sorted.length) {
    sorted[i].floor += 1;
    assigned += 1;
    i += 1;
  }

  return Object.fromEntries(raw.map((r) => [r.key, r.floor]));
}

/**
 * Build segments in token space. Autocompact is pinned to the window tail.
 * @param {number} maxTokens
 * @param {ContextCategories} categories
 */
function buildSegments(maxTokens, categories) {
  const autocompact = categories.autocompactBuffer;
  const usable = Math.max(0, maxTokens - autocompact);

  let head = {
    systemPrompt: clampNonNeg(categories.systemPrompt, usable),
    systemTools: clampNonNeg(categories.systemTools, usable),
    customAgents: clampNonNeg(categories.customAgents, usable),
    skills: clampNonNeg(categories.skills, usable),
    messages: clampNonNeg(categories.messages, usable),
  };

  let offset =
    head.systemPrompt +
    head.systemTools +
    head.customAgents +
    head.skills +
    head.messages;

  if (offset > usable) {
    const overflow = offset - usable;
    head.messages = Math.max(0, head.messages - overflow);
    offset =
      head.systemPrompt +
      head.systemTools +
      head.customAgents +
      head.skills +
      head.messages;
  }

  const freeTokens = usable - offset;
  /** @type {Array<{key: string, start: number, end: number}>} */
  const segments = [];
  let cursor = 0;

  for (const key of [
    "systemPrompt",
    "systemTools",
    "customAgents",
    "skills",
    "messages",
  ]) {
    const size = head[key];
    if (size > 0) {
      segments.push({ key, start: cursor, end: cursor + size });
      cursor += size;
    }
  }

  if (freeTokens > 0) {
    segments.push({ key: "free", start: cursor, end: cursor + freeTokens });
  }

  if (autocompact > 0) {
    segments.push({
      key: "autocompactBuffer",
      start: maxTokens - autocompact,
      end: maxTokens,
    });
  }

  return { segments, freeTokens, head, autocompact };
}

/**
 * @param {number} maxTokens
 * @param {Array<{key: string, start: number, end: number}>} segments
 */
function buildGrid(maxTokens, segments) {
  const blockTokens = Math.max(1, Math.ceil(maxTokens / TARGET_BLOCKS));
  const totalBlocks = Math.ceil(maxTokens / blockTokens);
  /** @type {string[]} */
  const grid = [];

  for (let i = 0; i < totalBlocks; i += 1) {
    const start = i * blockTokens;
    const end = Math.min(maxTokens, start + blockTokens);
    const mid = start + (end - start) / 2;
    const seg =
      segments.find((s) => mid >= s.start && mid < s.end) ||
      segments[segments.length - 1];
    grid.push(seg ? seg.key : "free");
  }

  return { blockTokens, totalBlocks, grid };
}

/**
 * Pure layout + grid math. Percents sum to exactly 100%.
 * @param {ContextInput} input
 * @returns {ContextSnapshot}
 */
export function computeContextSnapshot(input) {
  const { modelName, maxTokens } = input;
  const categories = { ...input.categories };

  if (categories.autocompactBuffer <= 0) {
    categories.autocompactBuffer = calcAutocompactBuffer(maxTokens);
  }

  const { segments, freeTokens, head, autocompact } = buildSegments(
    maxTokens,
    categories
  );
  const { blockTokens, totalBlocks, grid } = buildGrid(maxTokens, segments);

  const tokenMap = {
    systemPrompt: head.systemPrompt,
    systemTools: head.systemTools,
    customAgents: head.customAgents,
    skills: head.skills,
    messages: head.messages,
    free: freeTokens,
    autocompactBuffer: autocompact,
  };

  const percentMap = integerPercents(
    CATEGORY_ORDER.map((key) => ({ key, tokens: tokenMap[key] })),
    maxTokens
  );

  const breakdown = CATEGORY_ORDER.map((key) => ({
    key,
    label: CATEGORY_META[key].label,
    tokens: tokenMap[key],
    percent: percentMap[key],
  }));

  const usedTokens =
    head.systemPrompt +
    head.systemTools +
    head.customAgents +
    head.skills +
    head.messages +
    autocompact;

  return {
    modelName,
    maxTokens,
    blockTokens,
    totalBlocks,
    grid,
    breakdown,
    freeTokens,
    freePercent: percentMap.free,
    usedTokens,
    usedPercent: 100 - percentMap.free,
  };
}

/**
 * Map live chat state → ContextInput.
 * @param {Object} p
 * @param {string} p.modelName
 * @param {number} p.maxTokens
 * @param {number} p.messageTokens
 * @param {Partial<ContextCategories>} [p.overrides]
 */
export function buildChatContextInput({
  modelName,
  maxTokens,
  messageTokens,
  overrides = {},
}) {
  const autocompactBuffer = calcAutocompactBuffer(maxTokens);
  return {
    modelName,
    maxTokens,
    categories: {
      systemPrompt: overrides.systemPrompt ?? 0,
      systemTools: overrides.systemTools ?? 0,
      customAgents: overrides.customAgents ?? 0,
      skills: overrides.skills ?? 0,
      messages: messageTokens,
      autocompactBuffer,
    },
  };
}
