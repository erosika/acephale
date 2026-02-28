import {
  GoogleGenerativeAI,
  type GenerativeModel,
  type GenerationConfig,
} from "@google/generative-ai";
import { getEnv } from "./config.js";

// --- Client Singletons ---

let genAI: GoogleGenerativeAI | null = null;
let proModel: GenerativeModel | null = null;
let flashModel: GenerativeModel | null = null;

function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(getEnv("GEMINI_API_KEY"));
  }
  return genAI;
}

export function getGeminiPro(): GenerativeModel {
  if (!proModel) {
    proModel = getClient().getGenerativeModel({ model: "gemini-2.5-pro" });
  }
  return proModel;
}

export function getGeminiFlash(): GenerativeModel {
  if (!flashModel) {
    flashModel = getClient().getGenerativeModel({ model: "gemini-2.5-flash" });
  }
  return flashModel;
}

// --- Structured Generation ---

export async function generateStructured<T>(
  model: GenerativeModel,
  prompt: string,
  parse: (raw: string) => T
): Promise<T> {
  const config: GenerationConfig = {
    responseMimeType: "application/json",
  };

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: config,
  });

  const text = result.response.text();
  return parse(text);
}

export async function generateText(
  model: GenerativeModel,
  prompt: string
): Promise<string> {
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  return result.response.text();
}

export function _resetGemini(): void {
  genAI = null;
  proModel = null;
  flashModel = null;
}
