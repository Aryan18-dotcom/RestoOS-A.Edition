import { DailyTokenSequence } from "../models/index.js";

export function businessDateFor(timezone = "Asia/Kolkata", date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function allocateDailyToken(tenantId, businessDate, session) {
  const sequence = await DailyTokenSequence.findOneAndUpdate(
    { tenantId, businessDate },
    { $inc: { sequence: 1 }, $setOnInsert: { tenantId, businessDate } },
    { new: true, upsert: true, session }
  );
  return sequence.sequence;
}
