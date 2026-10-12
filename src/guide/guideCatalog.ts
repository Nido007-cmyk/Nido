/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * User guide ("Aprende a usar NIDO") — structure and promises.
 *
 * The TEXT of every lesson lives in the locale files (guide.modules), so it
 * is translated like the rest of the app. This file says, for each lesson,
 * which agent tools it depends on (to tell the user when one is switched off
 * in About → Agent permissions) and, for each example in order, which path
 * the app takes when it's sent. guideRouting.test.ts sends every example of
 * every language through the real routers: if a feature ever stops working
 * the way the guide promises, that test fails instead of the guide lying.
 *
 * Pure, no dependencies.
 */

export type GuideRoute =
  | "smallTalk" // instant reply (smallTalk.ts)
  | "calc" // calculator (actionRouter.extractCalcAction)
  | "reminderCreate" // reminder (actionRouter.extractReminderAction)
  | "remember" // "recuerda que…" (rememberRouter.extractRememberFact)
  | "contact" // contacts / calls (contactRouter.extractContactAction)
  | "knowledge" // normal chat with the offline knowledge base
  | `tool:${string}`; // toolRouter.extractToolAction kind

export interface GuideLessonSpec {
  id: string;
  /** Agent tools this lesson needs (About → Agent permissions). */
  tools?: string[];
  /** Expected path of each example, in the same order as in the locale files. */
  routes?: GuideRoute[];
}

export interface GuideModuleSpec {
  id: string;
  lessons: GuideLessonSpec[];
}

export const GUIDE_MODULES: GuideModuleSpec[] = [
  {
    id: "start",
    lessons: [
      { id: "chat", routes: ["smallTalk", "smallTalk", "smallTalk"] },
      {
        id: "quick",
        tools: ["device_time", "calculate", "convert_units"],
        routes: ["tool:time", "calc", "calc", "tool:convert"],
      },
    ],
  },
  {
    id: "organize",
    lessons: [
      { id: "reminders", tools: ["create_reminder"], routes: ["reminderCreate", "reminderCreate", "tool:reminderList"] },
      { id: "notes", tools: ["save_note", "list_notes", "read_note"], routes: ["tool:noteSave", "tool:noteList", "tool:noteRead"] },
      { id: "memory", tools: ["remember_fact"], routes: ["remember", "remember"] },
      {
        id: "calendar",
        tools: ["list_calendar_events", "create_calendar_event"],
        routes: ["tool:calendarList", "tool:calendarList", "tool:calendarCreate"],
      },
      { id: "contacts", tools: ["find_contact", "place_call"], routes: ["contact", "contact"] },
    ],
  },
  {
    id: "knowledge",
    lessons: [
      { id: "wikipedia", routes: ["knowledge", "knowledge"] },
      { id: "documents", routes: ["knowledge"] },
      { id: "multilingual" },
      { id: "linksFiles", tools: ["open_app", "read_picked_file"], routes: ["tool:openLink", "tool:pickFile"] },
    ],
  },
  {
    id: "connect",
    lessons: [{ id: "p2p" }, { id: "outside" }, { id: "voice" }],
  },
  {
    id: "privacy",
    lessons: [{ id: "offline" }, { id: "hardware" }, { id: "backup" }, { id: "erase" }],
  },
  {
    id: "personalize",
    lessons: [{ id: "models" }, { id: "tone" }, { id: "problems" }],
  },
];

/** Onboarding screen 2 examples, in order. */
export const ONBOARDING_ROUTES: GuideRoute[] = ["smallTalk", "calc", "reminderCreate"];

export function allLessonIds(): string[] {
  return GUIDE_MODULES.flatMap((m) => m.lessons.map((l) => `${m.id}.${l.id}`));
}
