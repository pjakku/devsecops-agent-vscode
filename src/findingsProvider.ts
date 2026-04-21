import * as path from "path";
import * as vscode from "vscode";
import { Finding, Severity } from "./backendRunner";

const severityOrder: Severity[] = ["critical", "high", "medium", "low", "info", "unknown"];

export class FindingsProvider implements vscode.TreeDataProvider<ResultNode> {
  private readonly changed = new vscode.EventEmitter<ResultNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.changed.event;

  private findings: Finding[] = [];
  private showOnlySemgrep = false;
  private workspaceFolder?: vscode.WorkspaceFolder;

  setResults(findings: Finding[], workspaceFolder: vscode.WorkspaceFolder): void {
    this.findings = findings;
    this.workspaceFolder = workspaceFolder;
    this.changed.fire();
  }

  clear(): void {
    this.findings = [];
    this.changed.fire();
  }

  showSemgrepOnly(): void {
    this.showOnlySemgrep = true;
    this.changed.fire();
  }

  showAll(): void {
    this.showOnlySemgrep = false;
    this.changed.fire();
  }

  getTreeItem(element: ResultNode): vscode.TreeItem {
    if (element instanceof SeverityNode) {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${element.findings.length}`;
      item.contextValue = "severity";
      return item;
    }

    const item = new vscode.TreeItem(element.finding.title, vscode.TreeItemCollapsibleState.None);
    item.description = this.descriptionFor(element.finding);
    item.tooltip = this.tooltipFor(element.finding);
    item.contextValue = "finding";
    item.iconPath = new vscode.ThemeIcon("warning");
    item.command = {
      command: "devsecopsAgent.openFinding",
      title: "Open Finding",
      arguments: [element.finding]
    };
    return item;
  }

  getChildren(element?: ResultNode): ResultNode[] {
    if (element instanceof SeverityNode) {
      return element.findings.map((finding) => new FindingNode(finding));
    }

    const visibleFindings = this.visibleFindings();
    if (visibleFindings.length === 0) {
      return [];
    }

    const grouped = new Map<Severity, Finding[]>();
    for (const finding of visibleFindings) {
      const severity = normalizeSeverity(finding.severity);
      const existing = grouped.get(severity) ?? [];
      existing.push(finding);
      grouped.set(severity, existing);
    }

    return severityOrder
      .filter((severity) => grouped.has(severity))
      .map((severity) => new SeverityNode(severityLabel(severity), grouped.get(severity) ?? []));
  }

  private descriptionFor(finding: Finding): string | undefined {
    const parts = [scannerLabel(finding), finding.category, this.displayPath(finding.filePath)].filter(Boolean);
    return parts.length > 0 ? parts.join(" - ") : undefined;
  }

  private tooltipFor(finding: Finding): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**${finding.title}**\n\n`);
    tooltip.appendMarkdown(`Severity: ${severityLabel(normalizeSeverity(finding.severity))}\n\n`);

    const details = [
      ["Scanner", scannerLabel(finding)],
      ["Category", finding.category],
      ["File", this.displayPath(finding.filePath)],
      ["Line", finding.line?.toString()]
    ];

    for (const [label, value] of details) {
      if (value) {
        tooltip.appendMarkdown(`${label}: ${value}\n\n`);
      }
    }

    if (finding.message) {
      tooltip.appendMarkdown(finding.message);
    }

    return tooltip;
  }

  private displayPath(filePath: string | undefined): string | undefined {
    if (!filePath) {
      return undefined;
    }

    if (!this.workspaceFolder || !path.isAbsolute(filePath)) {
      return filePath;
    }

    return path.relative(this.workspaceFolder.uri.fsPath, filePath) || filePath;
  }

  private visibleFindings(): Finding[] {
    if (!this.showOnlySemgrep) {
      return this.findings;
    }

    return this.findings.filter(isSemgrepFinding);
  }
}

export type ResultNode = SeverityNode | FindingNode;

export class SeverityNode {
  constructor(
    readonly label: string,
    readonly findings: Finding[]
  ) {}
}

export class FindingNode {
  constructor(readonly finding: Finding) {}
}

export function normalizeSeverity(severity: string | undefined): Severity {
  const normalized = severity?.toLowerCase();
  if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low" || normalized === "info") {
    return normalized;
  }

  return "unknown";
}

function severityLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function scannerLabel(finding: Finding): string | undefined {
  const scanner = finding.scanner_name ?? finding.scanner;
  if (!scanner) {
    return undefined;
  }

  return scanner.toLowerCase() === "semgrep" ? "SAST" : scanner;
}

function isSemgrepFinding(finding: Finding): boolean {
  return (finding.scanner_name ?? finding.scanner)?.toLowerCase() === "semgrep";
}
