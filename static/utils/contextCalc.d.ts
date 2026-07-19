export interface ContextCategories {
  systemPrompt: number;
  systemTools: number;
  customAgents: number;
  skills: number;
  messages: number;
  autocompactBuffer: number;
}

export interface ContextInput {
  modelName: string;
  maxTokens: number;
  categories: ContextCategories;
}

export interface CategorySlice {
  key: string;
  label: string;
  tokens: number;
  percent: number;
}

export interface ContextSnapshot {
  modelName: string;
  maxTokens: number;
  blockTokens: number;
  totalBlocks: number;
  grid: string[];
  breakdown: CategorySlice[];
  freeTokens: number;
  freePercent: number;
  usedTokens: number;
  usedPercent: number;
}

export function calcAutocompactBuffer(maxTokens: number): number;
export function computeContextSnapshot(input: ContextInput): ContextSnapshot;
export function buildChatContextInput(params: {
  modelName: string;
  maxTokens: number;
  messageTokens: number;
  overrides?: Partial<ContextCategories>;
}): ContextInput;
