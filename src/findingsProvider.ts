import * as path from "path";
import * as vscode from "vscode";
import { Finding, ScannerExecution, Severity } from "./backendRunner";

const severityOrder: Severity[] = ["critical", "high", "medium", "low", "info", "unknown"];
const scannerDisplayNames: Record<string, string> = {
  semgrep: "SAST",
  gitleaks: "Secrets",
  source_scanner: "Source/Secrets",
  script_scanner: "Script",
  manifest_scanner: "Kubernetes/Manifest",
  config_scanner: "Config",
  dependency_scanner: "Dependency"
};

const categoryDisplayNames: Record<string, string> = {
  sast: "SAST",
  secrets: "Secrets",
  script: "Script",
  manifest: "Kubernetes/Manifest",
  config: "Config",
  dependency: "Dependency"
};

export type FindingsFilter = "all" | "sast" | "secrets" | "script" | "manifest" | "config" | "dependency";

export interface FindingsViewState {
  activeFilter: FindingsFilter;
  activeFilterLabel: string;
  totalCount: number;
  visibleCount: number;
  hasScanned: boolean;
  isScanning: boolean;
  filteredEmpty: boolean;
  hasAnyFindings: boolean;
}

export class FindingsProvider implements vscode.TreeDataProvider<ResultNode> {
  private readonly changed = new vscode.EventEmitter<ResultNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.changed.event;

  private findings: Finding[] = [];
  private totalFindings = 0;
  private activeFilter: FindingsFilter = "all";
  private hasScanned = false;
  private isScanning = false;
  private scannerExecutions: ScannerExecution[] = [];
  private workspaceFolder?: vscode.WorkspaceFolder;

  setResults(
    findings: Finding[],
    workspaceFolder: vscode.WorkspaceFolder,
    totalFindings: number,
    scannerExecutions: ScannerExecution[]
  ): void {
    this.findings = findings;
    this.totalFindings = totalFindings;
    this.hasScanned = true;
    this.isScanning = false;
    this.scannerExecutions = scannerExecutions;
    this.workspaceFolder = workspaceFolder;
    this.changed.fire();
  }

  clear(): void {
    this.findings = [];
    this.totalFindings = 0;
    this.isScanning = false;
    this.scannerExecutions = [];
    this.changed.fire();
  }

  startScan(): void {
    this.isScanning = true;
    this.changed.fire();
  }

  showSemgrepOnly(): void {
    this.setFilter("sast");
  }

  showSecretsOnly(): void {
    this.setFilter("secrets");
  }

  showScriptOnly(): void {
    this.setFilter("script");
  }

  showManifestOnly(): void {
    this.setFilter("manifest");
  }

  showConfigOnly(): void {
    this.setFilter("config");
  }

  showDependencyOnly(): void {
    this.setFilter("dependency");
  }

  setFilter(filter: FindingsFilter): void {
    this.activeFilter = filter;
    this.changed.fire();
  }

  showAll(): void {
    this.setFilter("all");
  }

  getViewState(): FindingsViewState {
    const totalCount = this.totalFindings;
    const visibleCount = this.visibleFindings().length;
    return {
      activeFilter: this.activeFilter,
      activeFilterLabel: filterLabel(this.activeFilter),
      totalCount,
      visibleCount,
      hasScanned: this.hasScanned,
      isScanning: this.isScanning,
      filteredEmpty: this.hasScanned && totalCount > 0 && visibleCount === 0,
      hasAnyFindings: totalCount > 0
    };
  }

  getTreeItem(element: ResultNode): vscode.TreeItem {
    if (element instanceof StatusNode) {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = "status";
      item.iconPath = new vscode.ThemeIcon(element.icon);
      item.description = element.description;
      return item;
    }

    if (element instanceof ActionGroupNode) {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = "actions";
      item.iconPath = new vscode.ThemeIcon("tools");
      return item;
    }

    if (element instanceof ActionItemNode) {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = "action";
      item.iconPath = new vscode.ThemeIcon(element.icon);
      item.command = {
        command: element.command,
        title: element.label
      };
      return item;
    }

    if (element instanceof FilterGroupNode) {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = "filters";
      item.iconPath = new vscode.ThemeIcon("filter");
      return item;
    }

    if (element instanceof FilterItemNode) {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = "filterItem";
      item.iconPath = new vscode.ThemeIcon(element.icon);
      item.command = {
        command: element.command,
        title: element.label
      };
      return item;
    }

    if (element instanceof ScannerStatusGroupNode) {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = "scannerStatus";
      item.iconPath = new vscode.ThemeIcon("pulse");
      return item;
    }

    if (element instanceof ScannerStatusItemNode) {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = "scannerStatusItem";
      item.iconPath = new vscode.ThemeIcon(element.icon);
      item.description = element.description;
      item.tooltip = element.tooltip;
      return item;
    }

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
    if (element instanceof StatusNode || element instanceof ActionItemNode) {
      return [];
    }

    if (element instanceof ActionGroupNode) {
      return buildActionItems();
    }

    if (element instanceof FilterGroupNode) {
      return this.buildFilterItems();
    }

    if (element instanceof ScannerStatusGroupNode) {
      return this.buildScannerStatusItems();
    }

    if (element instanceof SeverityNode) {
      return element.findings.map((finding) => new FindingNode(finding));
    }

    if (this.isScanning) {
      return [new StatusNode("Scanning workspace...", "sync~spin")];
    }

    if (!this.hasScanned) {
      return [];
    }

    const visibleFindings = this.visibleFindings();
    const nodes: ResultNode[] = [
      new StatusNode(this.filterStatusLabel(), "filter"),
      new ActionGroupNode("Actions"),
      new FilterGroupNode("Filters")
    ];

    if (this.scannerExecutions.length > 0) {
      nodes.push(new ScannerStatusGroupNode("Scanner Status"));
    }

    if (visibleFindings.length === 0) {
      nodes.push(
        new StatusNode(
          this.findings.length === 0 ? "Latest scan returned no findings" : "No findings match current filter",
          this.findings.length === 0 ? "search" : "search-stop",
          this.findings.length === 0 ? "Run another scan or inspect a different workspace." : "Try Show All Findings or run another scan."
        )
      );
      return nodes;
    }

    const grouped = new Map<Severity, Finding[]>();
    for (const finding of visibleFindings) {
      const severity = normalizeSeverity(finding.severity);
      const existing = grouped.get(severity) ?? [];
      existing.push(finding);
      grouped.set(severity, existing);
    }

    return nodes.concat(
      severityOrder
        .filter((severity) => grouped.has(severity))
        .map((severity) => new SeverityNode(severityLabel(severity), grouped.get(severity) ?? []))
    );
  }

  private descriptionFor(finding: Finding): string | undefined {
    const parts = [severityLabel(normalizeSeverity(finding.severity)), findingKindLabel(finding), this.displayLocation(finding)].filter(Boolean);
    return parts.length > 0 ? parts.join(" - ") : undefined;
  }

  private tooltipFor(finding: Finding): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**${finding.title}**\n\n`);
    tooltip.appendMarkdown(`Severity: ${severityLabel(normalizeSeverity(finding.severity))}\n\n`);

    const details = [
      ["Type", findingKindLabel(finding)],
      ["Scanner", finding.scanner_name ?? finding.scanner],
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

    if (finding.recommendation) {
      tooltip.appendMarkdown(`\n\nRecommendation: ${finding.recommendation}`);
    }

    return tooltip;
  }

  private displayLocation(finding: Finding): string | undefined {
    const filePath = this.displayPath(finding.filePath);
    if (!filePath) {
      return undefined;
    }

    return finding.line ? `${filePath}:${finding.line}` : filePath;
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
    if (this.activeFilter === "all") {
      return this.findings;
    }

    return this.findings.filter((finding) => matchesFilter(finding, this.activeFilter));
  }

  private filterStatusLabel(): string {
    const visibleCount = this.visibleFindings().length;
    return `Filter: ${filterLabel(this.activeFilter)} (${visibleCount} of ${this.totalFindings})`;
  }

  private buildFilterItems(): FilterItemNode[] {
    return [
      new FilterItemNode(`SAST (${this.countForFilter("sast")})`, "devsecopsAgent.showSast", "shield"),
      new FilterItemNode(`Secrets (${this.countForFilter("secrets")})`, "devsecopsAgent.showSecrets", "key"),
      new FilterItemNode(`Script (${this.countForFilter("script")})`, "devsecopsAgent.showScript", "code"),
      new FilterItemNode(`Kubernetes/Manifest (${this.countForFilter("manifest")})`, "devsecopsAgent.showManifest", "package"),
      new FilterItemNode(`Config (${this.countForFilter("config")})`, "devsecopsAgent.showConfig", "settings-gear"),
      new FilterItemNode(`Dependency (${this.countForFilter("dependency")})`, "devsecopsAgent.showDependency", "extensions")
    ];
  }

  private countForFilter(filter: Exclude<FindingsFilter, "all">): number {
    return this.findings.filter((finding) => matchesFilter(finding, filter)).length;
  }

  private buildScannerStatusItems(): ScannerStatusItemNode[] {
    return this.scannerExecutions
      .filter((execution) => relevantScanner(execution.scannerName))
      .map((execution) => {
        const status = execution.status || "unknown";
        return new ScannerStatusItemNode(
          `${scannerStatusLabel(execution.scannerName)}: ${status}`,
          statusIcon(status),
          execution.message ?? execution.command,
          execution.command
        );
      });
  }
}

export type ResultNode =
  | StatusNode
  | ActionGroupNode
  | ActionItemNode
  | FilterGroupNode
  | FilterItemNode
  | ScannerStatusGroupNode
  | ScannerStatusItemNode
  | SeverityNode
  | FindingNode;

export class StatusNode {
  constructor(
    readonly label: string,
    readonly icon: string,
    readonly description?: string
  ) {}
}

export class ActionGroupNode {
  constructor(readonly label: string) {}
}

export class ActionItemNode {
  constructor(
    readonly label: string,
    readonly command: string,
    readonly icon: string
  ) {}
}

export class FilterGroupNode {
  constructor(readonly label: string) {}
}

export class FilterItemNode {
  constructor(
    readonly label: string,
    readonly command: string,
    readonly icon: string
  ) {}
}

export class ScannerStatusGroupNode {
  constructor(readonly label: string) {}
}

export class ScannerStatusItemNode {
  constructor(
    readonly label: string,
    readonly icon: string,
    readonly description?: string,
    readonly tooltip?: string
  ) {}
}

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

function filterLabel(filter: FindingsFilter): string {
  if (filter === "all") {
    return "All Findings";
  }

  return categoryDisplayNames[filter];
}

function findingKindLabel(finding: Finding): string {
  const scanner = normalizedScanner(finding);
  if (scanner && scannerDisplayNames[scanner]) {
    return scannerDisplayNames[scanner];
  }

  const category = normalizedCategory(finding);
  if (category && categoryDisplayNames[category]) {
    return categoryDisplayNames[category];
  }

  return finding.scanner_name ?? finding.scanner ?? finding.category ?? "Finding";
}

function matchesFilter(finding: Finding, filter: FindingsFilter): boolean {
  const category = normalizedCategory(finding);
  const scanner = normalizedScanner(finding);

  switch (filter) {
    case "all":
      return true;
    case "sast":
      return category === "sast" || scanner === "semgrep";
    case "secrets":
      return category === "secrets" || scanner === "gitleaks";
    case "script":
      return category === "script" || scanner === "script_scanner";
    case "manifest":
      return category === "manifest" || scanner === "manifest_scanner";
    case "config":
      return category === "config" || scanner === "config_scanner";
    case "dependency":
      return category === "dependency" || scanner === "dependency_scanner";
  }
}

function normalizedScanner(finding: Finding): string | undefined {
  return (finding.scanner_name ?? finding.scanner)?.toLowerCase();
}

function normalizedCategory(finding: Finding): string | undefined {
  return finding.category?.toLowerCase();
}

function buildActionItems(): ActionItemNode[] {
  return [
    new ActionItemNode("Run Scan", "devsecopsAgent.scanWorkspace", "play"),
    new ActionItemNode("Show All Findings", "devsecopsAgent.showAll", "list-tree")
  ];
}

function relevantScanner(scannerName: string): boolean {
  const normalized = scannerName.toLowerCase();
  return normalized === "semgrep" || normalized === "gitleaks" || normalized === "script_scanner" || normalized === "manifest_scanner";
}

function scannerStatusLabel(scannerName: string): string {
  const normalized = scannerName.toLowerCase();
  if (normalized === "semgrep") {
    return "Semgrep";
  }

  if (normalized === "gitleaks") {
    return "Gitleaks";
  }

  if (normalized === "script_scanner") {
    return "Script Scanner";
  }

  if (normalized === "manifest_scanner") {
    return "Manifest Scanner";
  }

  return scannerName;
}

function statusIcon(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "ran") {
    return "check";
  }

  if (normalized === "skipped") {
    return "debug-pause";
  }

  if (normalized === "failed") {
    return "error";
  }

  return "circle-large-outline";
}
