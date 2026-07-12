import type {
  PrimeFigureSchedule,
  PrimeFigureScheduleSegment,
  PrimeFigureWeekday,
} from "@echoo/shared";
import { APP_TIME_ZONE } from "../../../../shared/constants/time.js";

const WEEKDAYS: PrimeFigureWeekday[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

export function formatReadableMinute(timestampMs: number, timezone: string) {
  const parts = getDateTimeParts(timestampMs, timezone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatWeekdayCode(timestampMs: number, timezone: string) {
  const parts = getDateTimeParts(timestampMs, timezone);
  return WEEKDAYS[parts.weekday] ?? "sun";
}

export function parseReadableMinute(value: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  let guess = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
  );

  for (let index = 0; index < 3; index += 1) {
    const actual = getDateTimeParts(guess, timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const targetAsUtc = Date.UTC(
      target.year,
      target.month - 1,
      target.day,
      target.hour,
      target.minute,
    );
    guess += targetAsUtc - actualAsUtc;
  }

  return Number.isFinite(guess) &&
    formatReadableMinute(guess, timezone) === value
    ? guess
    : null;
}

export function describeAge(fromMs: number, nowMs: number) {
  const minutes = Math.max(0, Math.round((nowMs - fromMs) / 60_000));
  if (minutes < 2) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}小时前`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days}天前`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months}个月前`;
  return `${Math.round(months / 12)}年前`;
}

export function findScheduleSegment(
  schedule: PrimeFigureSchedule,
  timestampMs: number,
): PrimeFigureScheduleSegment | null {
  const parts = getDateTimeParts(timestampMs, APP_TIME_ZONE);
  const weekday = WEEKDAYS[parts.weekday] ?? "sun";
  const minuteOfDay = parts.hour * 60 + parts.minute;

  return (
    schedule.segments.find((segment) => {
      const start = toMinuteOfDay(segment.start);
      const end = toMinuteOfDay(segment.end);
      if (start === null || end === null) return false;
      if (end > start)
        return (
          segment.days.includes(weekday) &&
          minuteOfDay >= start &&
          minuteOfDay < end
        );
      if (minuteOfDay >= start) return segment.days.includes(weekday);
      const previousWeekday = WEEKDAYS[(parts.weekday + 6) % 7] ?? "sat";
      return minuteOfDay < end && segment.days.includes(previousWeekday);
    }) ?? null
  );
}

interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

function getDateTimeParts(
  timestampMs: number,
  timezone: string,
): DateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(timestampMs))
      .map((part) => [part.type, part.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday ?? "Sun",
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: Math.max(weekday, 0),
  };
}

function safeTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return "UTC";
  }
}

function toMinuteOfDay(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
