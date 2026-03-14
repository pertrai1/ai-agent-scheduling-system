import {
  GoogleGenerativeAI,
  type GenerativeModel,
} from "@google/generative-ai";

export interface GeminiClientOptions {
  apiKey: string;
  model?: string;
}

export class GeminiClient {
  private model: GenerativeModel;

  constructor(options: GeminiClientOptions) {
    const genAI = new GoogleGenerativeAI(options.apiKey);
    this.model = genAI.getGenerativeModel({
      model: options.model ?? "gemini-1.5-flash",
    });
  }

  async generateText(prompt: string): Promise<string> {
    const result = await this.model.generateContent(prompt);
    const response = result.response;
    return response.text();
  }
}
