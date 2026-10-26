"use client";

/**
 * The /admin section registry. To add a tab (e.g. the web3 agent's chain / Prize Pool tabs),
 * create a client component and add ONE entry here; the shell renders the tabs from this list.
 */
import type { ComponentType } from "react";
import { FeedbackSection } from "./FeedbackSection";
import { InvitesSection } from "./InvitesSection";
import { MetricsSection } from "./MetricsSection";
import { PayoutsSection } from "./PayoutsSection";
import { ResetSection } from "./ResetSection";
import { TestersSection } from "./TestersSection";

export interface AdminSection {
  key: string;
  label: string;
  Component: ComponentType;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { key: "metrics", label: "Metrics", Component: MetricsSection },
  { key: "invites", label: "Invites", Component: InvitesSection },
  { key: "testers", label: "Testers", Component: TestersSection },
  { key: "feedback", label: "Feedback", Component: FeedbackSection },
  { key: "payouts", label: "Payouts (manual)", Component: PayoutsSection },
  { key: "reset", label: "Reset", Component: ResetSection },
];
