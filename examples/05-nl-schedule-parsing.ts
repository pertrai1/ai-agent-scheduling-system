/**
 * Example 05 – Natural Language Schedule Parsing
 *
 * The system can translate plain-English schedule descriptions into cron
 * expressions so users never need to remember cron syntax.
 *
 * This example passes several natural language inputs through the LLM-backed
 * parser and prints the resulting cron expression together with a
 * human-readable confirmation message.
 *
 * Run with:
 *   GEMINI_API_KEY=<your-key> npx tsx examples/05-nl-schedule-parsing.ts
 */

import { loadConfig } from "../src/config";
import { GeminiClient } from "../src/geminiClient";
import {
  parseNaturalLanguageSchedule,
  formatScheduleConfirmation,
  isParsedSchedule,
} from "../src/nlScheduleParser";

void (async () => {
  const config = loadConfig();

  const client = new GeminiClient({
    apiKey: config.GEMINI_API_KEY,
    model: config.GEMINI_MODEL,
  });

  const inputs = [
    "every day at 7am",
    "every weekday at 9am",
    "every Monday at 8am",
    "every 3 hours",
    "twice a day",
    "the first of every month at midnight",
    "sometimes in the morning", // deliberately ambiguous – should return an error
  ];

  console.log("Natural Language Schedule Parser\n");
  console.log("=".repeat(60));

  for (const input of inputs) {
    console.log(`\nInput : "${input}"`);

    const result = await parseNaturalLanguageSchedule(input, client);

    if (isParsedSchedule(result)) {
      console.log(`Cron  : ${result.cron}`);
      console.log(`Human : ${result.description}`);
      if (result.notes) {
        console.log(`Notes : ${result.notes}`);
      }
      console.log(`Msg   : ${formatScheduleConfirmation(result)}`);
    } else {
      console.log(`⚠️  Error: ${result.error}`);
    }
  }
})();
