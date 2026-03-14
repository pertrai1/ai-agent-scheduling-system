import { CronExpressionParser } from "cron-parser";

/**
 * Returns true if the given string is a valid five-field cron expression.
 */
export function validateCronExpression(expression: string): boolean {
  if (!expression.trim()) return false;
  try {
    CronExpressionParser.parse(expression);
    return true;
  } catch {
    return false;
  }
}
