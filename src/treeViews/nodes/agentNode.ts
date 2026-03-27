import * as vscode from "vscode";
import { Agent } from "../../api/types";
import { getIconForAgent } from "../icons";

export class AgentNode extends vscode.TreeItem {
  constructor(
    public readonly agent: Agent,
    public readonly orgSlug: string,
  ) {
    super(AgentNode.getLabel(agent), vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon(
      getIconForAgent(
        agent.connection_state,
        agent.paused,
        !!agent.job,
      ),
    );
    this.tooltip = this.getTooltip();
    this.description = this.getDescription();
    this.contextValue = this.getContextValue();
  }

  /** Main line: name, (paused) only when paused, and job. We don't show "connected" — list only has connected agents. */
  private static getLabel(agent: Agent): string {
    const name = agent.name || agent.hostname || "Unknown Agent";
    const job =
      agent.job?.name || agent.job?.type || (agent.job ? "Running" : "Idle");
    const pausedPart = agent.paused ? " · (paused)" : "";
    return `${name}${pausedPart} · ${job}`;
  }

  /** Secondary line: hostname and version only (job is in the label to avoid duplicate). */
  private getDescription(): string {
    return `${this.agent.hostname} · v${this.agent.version}`;
  }

  /** Rich hover with full agent details. */
  private getTooltip(): vscode.MarkdownString {
    const a = this.agent;
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    md.appendMarkdown(`**${a.name || a.hostname || "Unknown Agent"}**\n\n`);
    md.appendMarkdown(`| Property | Value |\n`);
    md.appendMarkdown(`|----------|-------|\n`);
    md.appendMarkdown(`| **State** | \`${a.connection_state}\` |\n`);
    md.appendMarkdown(`| **Hostname** | ${a.hostname} |\n`);
    md.appendMarkdown(`| **Version** | ${a.version} |\n`);
    if (a.ip_address) {
      md.appendMarkdown(`| **IP** | ${a.ip_address} |\n`);
    }
    if (a.job) {
      const jobLabel = a.job.name || a.job.type || "—";
      const jobState = `\`${a.job.state}\``;
      if (a.job.web_url) {
        md.appendMarkdown(
          `| **Current job** | [${jobLabel}](${a.job.web_url}) (${jobState}) |\n`,
        );
      } else {
        md.appendMarkdown(
          `| **Current job** | ${jobLabel} (${jobState}) |\n`,
        );
      }
    } else {
      md.appendMarkdown(`| **Current job** | Idle |\n`);
    }
    if (a.creator?.name) {
      md.appendMarkdown(`| **Registered by** | ${a.creator.name} |\n`);
    }
    if (a.created_at) {
      try {
        const date = new Date(a.created_at);
        const absolute = date.toLocaleString();
        const relative = AgentNode.formatRelativeTime(date);
        md.appendMarkdown(
          `| **Registered** | ${absolute} (${relative}) |\n`,
        );
      } catch {
        md.appendMarkdown(`| **Registered** | ${a.created_at} |\n`);
      }
    }
    if (a.paused) {
      md.appendMarkdown(`| **Paused** | Yes |\n`);
    }
    if (a.paused && a.paused_at) {
      try {
        md.appendMarkdown(
          `| **Paused at** | ${new Date(a.paused_at).toLocaleString()} |\n`,
        );
      } catch {
        md.appendMarkdown(`| **Paused at** | ${a.paused_at} |\n`);
      }
    }
    if (a.paused && a.paused_by?.name) {
      md.appendMarkdown(`| **Paused by** | ${a.paused_by.name} |\n`);
    }
    if (a.paused && a.paused_note) {
      md.appendMarkdown(`| **Paused note** | ${a.paused_note} |\n`);
    }
    if (a.paused && a.paused_timeout_in_minutes !== undefined) {
      md.appendMarkdown(
        `| **Pause timeout** | ${a.paused_timeout_in_minutes} min |\n`,
      );
    }
    if (a.cluster_url) {
      md.appendMarkdown(`| **Cluster** | [Link](${a.cluster_url}) |\n`);
    }
    if (a.user_agent) {
      md.appendMarkdown(`\n*${a.user_agent}*\n`);
    }
    if (a.meta_data && a.meta_data.length > 0) {
      md.appendMarkdown(`\n**Tags:** ${a.meta_data.join(", ")}\n`);
    }
    if (a.web_url) {
      md.appendMarkdown(`\n[Open on Buildkite](${a.web_url})\n`);
    }

    return md;
  }

  private getContextValue(): string {
    const state = this.agent.connection_state;
    const hasJob = !!this.agent.job;
    if (state === "connected" && this.agent.paused && hasJob) {
      return "agent.connected.paused.running";
    }
    if (state === "connected" && this.agent.paused) {
      return "agent.connected.paused";
    }
    if (state === "connected" && hasJob) {
      return "agent.connected.running";
    }
    if (state === "connected") {
      return "agent.connected";
    }
    return `agent.${state}`;
  }

  private static formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    const weeks = Math.floor(diffDays / 7);
    if (diffDays < 30) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
    const months = Math.floor(diffDays / 30);
    return `${months} ${months === 1 ? "month" : "months"} ago`;
  }
}
