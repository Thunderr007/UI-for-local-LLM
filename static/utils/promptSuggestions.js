export const DEFAULT_PLACEHOLDER = "Message your local model…";

const EXPLAIN_PROMPTS = [
  "Explain quantum computing in simple terms.",
  "Explain how black holes form.",
  "Explain the difference between RNA and DNA.",
  "Explain how vaccines train the immune system.",
  "Explain blockchain in plain English.",
  "Explain why the sky appears blue.",
  "Explain how neural networks learn from data.",
  "Explain the causes of inflation in economics.",
  "Explain photosynthesis step by step.",
  "Explain how GPS determines your location.",
  "Explain CRISPR gene editing for beginners.",
  "Explain the water cycle and why it matters.",
  "Explain how solar panels convert sunlight to electricity.",
  "Explain the greenhouse effect simply.",
  "Explain how recommendation algorithms work.",
  "Explain plate tectonics and earthquakes.",
  "Explain how encryption keeps messages private.",
  "Explain sleep cycles and why we dream.",
  "Explain how the human digestive system works.",
  "Explain why compounding interest grows so fast.",
  "Explain how wind turbines generate electricity.",
  "Explain the basics of supply and demand.",
  "Explain how machine learning differs from traditional programming.",
  "Explain why seasons change throughout the year.",
  "Explain how the internet routes data between devices.",
];

export function randomExplainPrompt() {
  return EXPLAIN_PROMPTS[Math.floor(Math.random() * EXPLAIN_PROMPTS.length)];
}

/** @param {HTMLTextAreaElement|null} input */
export function applyExplainSuggestion(input) {
  if (!input) return;
  input.value = "";
  input.placeholder = randomExplainPrompt();
  input.classList.add("suggesting");
  input.focus();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** @param {HTMLTextAreaElement|null} input */
export function clearInputSuggestion(input) {
  if (!input) return;
  input.classList.remove("suggesting");
  input.placeholder = DEFAULT_PLACEHOLDER;
}
