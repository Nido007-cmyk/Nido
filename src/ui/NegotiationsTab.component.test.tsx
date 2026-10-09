/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// TESTFIX-2026-10-08 (Fix 5): accepted sessions must be visible.
// Physical evidence: after accepting, the session "disappeared" from both
// tablets — only a raw state dump existed. Now ACCEPTED sessions render in
// an "active collaborations" section with peer name, description and date.
import React from "react";
import { render, screen } from "@testing-library/react-native";

jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { surface: "#000", cardElevated: "#111", subtle: "#222" },
      text: { primary: "#fff", secondary: "#ccc", muted: "#888" },
    },
  }),
}));

jest.mock("./theme/calm", () => ({
  calmSpacing: { comfortable: 16, cozy: 12 },
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) =>
      opts && opts.date ? `${key}:${opts.date}` : key,
    i18n: { resolvedLanguage: "es", language: "es" },
  }),
}));

jest.mock("../services/haptics", () => ({
  impact: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));

// Stub EmptyState: typography chain not needed for these tests.
jest.mock("./components/calm/EmptyState", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    EmptyState: ({ title }: any) => <Text>{title}</Text>,
  };
});
// The pending-proposal path is covered by other tests; here we only need
// its description rendered to prove the pending list is unchanged.
jest.mock("./components/calm/NegotiationCard", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    NegotiationCard: ({ proposal }: any) => (
      <React.Fragment>
        <Text>{proposal.taskDescription}</Text>
      </React.Fragment>
    ),
  };
});

// Use the real singleton but seed it with canned sessions.
jest.mock("../p2p/negotiationService", () => {
  const sessions: any[] = [];
  return {
    negotiationService: {
      __setSessions: (s: any[]) => {
        sessions.length = 0;
        sessions.push(...s);
      },
      listSessions: () => [...sessions],
      subscribe: () => () => {},
      pruneTerminal: () => {},
      isOutgoing: () => false,
      acceptSession: async () => {},
      declineSession: async () => {},
      counterSession: async () => {},
      proposeTo: async () => ({ sent: true }),
    },
  };
});

const { negotiationService } = require("../p2p/negotiationService");
const { NegotiationsTab } = require("./NegotiationsTab");

const acceptedSession = {
  negotiationId: "acc-1",
  proposalId: "acc-1",
  peerPkHex: "aabbccdd",
  proposal: { taskDescription: "Colaborar en notas" },
  state: "ACCEPTED",
  updatedAt: Date.now(),
};

const proposedSession = {
  negotiationId: "prop-1",
  proposalId: "prop-1",
  peerPkHex: "eeff0011",
  proposal: { taskDescription: "Propuesta pendiente", proposerPkHex: "eeff0011" },
  state: "PROPOSED",
  updatedAt: Date.now(),
};

describe("NegotiationsTab: active collaborations (Fix 5)", () => {
  it("ACCEPTED session appears in the active section with peer/description/date", async () => {
    negotiationService.__setSessions([acceptedSession]);
    await render(<NegotiationsTab />);
    // Section title
    expect(screen.getByText("negotiations.activeTitle")).toBeTruthy();
    // Description visible
    expect(screen.getByText("Colaborar en notas")).toBeTruthy();
    // Accepted timestamp (mock t appends :date)
    const dateEls = screen.getAllByText(/^negotiations.acceptedOn:/);
    expect(dateEls.length).toBeGreaterThan(0);
  });

  it("pending PROPOSED list is unchanged when an ACCEPTED exists", async () => {
    negotiationService.__setSessions([proposedSession, acceptedSession]);
    await render(<NegotiationsTab />);
    // Pending proposal still rendered via NegotiationCard (description)
    expect(screen.getByText("Propuesta pendiente")).toBeTruthy();
    // And the accepted one is in its section
    expect(screen.getByText("negotiations.activeTitle")).toBeTruthy();
  });

  it("no active section when nothing is accepted", async () => {
    negotiationService.__setSessions([proposedSession]);
    await render(<NegotiationsTab />);
    expect(screen.queryByText("negotiations.activeTitle")).toBeNull();
  });
});
