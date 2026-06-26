#!/usr/bin/env node

/**
 * Fetches upcoming events from Google Calendar and writes events.json.
 * Designed to run in GitHub Actions with secrets as environment variables.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_CALENDAR_ID
 * Optional:
 *   DAYS_AHEAD (default: 7), TIMEZONE (default: Asia/Jerusalem)
 *   OUTPUT_PATH (default: ./family-calendar/events.json)
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_CALENDAR_ID'];

async function refreshAccessToken(clientId, clientSecret, refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function fetchCalendarEvents(accessToken, calendarId, timeMin, timeMax, timezone) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    timeZone: timezone,
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Calendar API failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function main() {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
      console.error(`Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const daysAhead = parseInt(process.env.DAYS_AHEAD || '7', 10);
  const timezone = process.env.TIMEZONE || 'Asia/Jerusalem';

  console.log('Refreshing access token...');
  const accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);
  console.log('Token refreshed successfully');

  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setHours(0, 0, 0, 0);

  const timeMax = new Date(timeMin);
  timeMax.setDate(timeMax.getDate() + daysAhead);
  timeMax.setHours(23, 59, 59, 999);

  console.log(`Fetching events from ${timeMin.toISOString()} to ${timeMax.toISOString()}`);

  const data = await fetchCalendarEvents(accessToken, calendarId, timeMin, timeMax, timezone);

  const items = data.items || [];

  const events = items.map((item) => {
    const isAllDay = !!item.start.date;
    return {
      id: item.id,
      title: item.summary || 'ללא כותרת',
      start: isAllDay ? item.start.date : item.start.dateTime,
      end: isAllDay ? item.end.date : item.end.dateTime,
      isAllDay,
      description: item.description || undefined,
    };
  });

  const output = {
    updatedAt: now.toISOString(),
    timezone,
    days: daysAhead,
    events,
  };

  const outPath = process.env.OUTPUT_PATH || path.join(__dirname, '..', 'family-calendar', 'events.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Written ${events.length} events to ${outPath}`);
}

main().catch((err) => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
