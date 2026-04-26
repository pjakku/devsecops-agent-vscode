import * as path from "path";
import * as vscode from "vscode";
import { BackendRunner, BackendRunnerError, Finding } from "./backendRunner";
import { FindingsProvider, FindingsViewState } from "./findingsProvider";

const resultsViewId = "devsecopsAgent.results";

export function activate(context: vscode.ExtensionContext): void {
  const backendRunner = new BackendRunner(context);
  const findingsProvider = new FindingsProvider();
  const output = vscode.window.createOutputChannel("DevSecOps Agent");
  const resultsView = vscode.window.createTreeView(resultsViewId, {
    treeDataProvider: findingsProvider,
    showCollapseAll: true
  });

  context.subscriptions.push(
    output,
    resultsView,
    vscode.commands.registerCommand("devsecopsAgent.scanWorkspace", () => scanWorkspace(backendRunner, findingsProvider, resultsView, output)),
    vscode.commands.registerCommand("devsecopsAgent.refreshResults", () => scanWorkspace(backendRunner, findingsProvider, resultsView, output)),
    vscode.commands.registerCommand("devsecopsAgent.refresh", () => scanWorkspace(backendRunner, findingsProvider, resultsView, output)),
    vscode.commands.registerCommand("devsecopsAgent.showOnlySemgrepFindings", () => applyViewFilter(resultsView, findingsProvider, () => findingsProvider.showSemgrepOnly())),
    vscode.commands.registerCommand("devsecopsAgent.showSast", () => applyViewFilter(resultsView, findingsProvider, () => findingsProvider.showSemgrepOnly())),
    vscode.commands.registerCommand("devsecopsAgent.showAllFindings", () => applyViewFilter(resultsView, findingsProvider, () => findingsProvider.showAll())),
    vscode.commands.registerCommand("devsecopsAgent.showAll", () => applyViewFilter(resultsView, findingsProvider, () => findingsProvider.showAll())),
    vscode.commands.registerCommand("devsecopsAgent.showSecrets", () => applyViewFilter(resultsView, findingsProvider, () => findingsProvider.showSecretsOnly())),
    vscode.commands.registerCommand("devsecopsAgent.showScript", () => applyViewFilter(resultsView, findingsProvider, () => findingsProvider.showScriptOnly())),
    vscode.commands.registerCommand("devsecopsAgent.showManifest", () => applyViewFilter(resultsView, findingsProvider, () => findingsProvider.showManifestOnly())),
    vscode.commands.registerCommand("devsecopsAgent.showConfig", () => applyViewFilter(resultsView, findingsProvider, () => findingsProvider.showConfigOnly())),
    vscode.commands.registerCommand("devsecopsAgent.showDependency", () => applyViewFilter(resultsView, findingsProvider, () => findingsProvider.showDependencyOnly())),
    vscode.commands.registerCommand("devsecopsAgent.openFinding", (finding: unknown) => openFinding(backendRunner, finding))
  );

  void updateViewPresentation(resultsView, findingsProvider);
}

export function deactivate(): void {}

async function scanWorkspace(
  backendRunner: BackendRunner,
  findingsProvider: FindingsProvider,
  resultsView: vscode.TreeView<unknown>,
  output: vscode.OutputChannel
): Promise<void> {
  try {
    findingsProvider.startScan();
    await updateViewPresentation(resultsView, findingsProvider);
    output.clear();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "DevSecOps Agent is scanning the workspace",
        cancellable: false
      },
      async () => {
        const workspaceFolder = backendRunner.getWorkspaceFolder();
        const report = await backendRunner.scanWorkspace();
        findingsProvider.setResults(report.findings, workspaceFolder, report.totalFindings, report.scannerExecutions);
        logScanReport(output, report);
        await updateViewPresentation(resultsView, findingsProvider);
        await focusResultsView();
        vscode.window.showInformationMessage(`DevSecOps Agent scan completed with ${report.totalFindings} finding(s).`);
      }
    );
  } catch (error) {
    findingsProvider.clear();
    await updateViewPresentation(resultsView, findingsProvider);
    output.appendLine(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
    showError(error);
  }
}

async function openFinding(backendRunner: BackendRunner, finding: unknown): Promise<void> {
  if (!isFinding(finding)) {
    vscode.window.showErrorMessage("DevSecOps Agent could not open this finding because the tree item did not pass finding metadata.");
    return;
  }

  const findingPath = finding.file_path ?? finding.filePath;
  if (!findingPath) {
    vscode.window.showWarningMessage(
      `This finding does not include file_path in the backend JSON. Finding: ${finding.finding_id ?? finding.id ?? finding.title}`
    );
    return;
  }

  try {
    const workspaceFolder = backendRunner.getWorkspaceFolder();
    const filePath = path.isAbsolute(findingPath)
      ? findingPath
      : path.join(workspaceFolder.uri.fsPath, findingPath);
    const fileUri = vscode.Uri.file(filePath);

    try {
      await vscode.workspace.fs.stat(fileUri);
    } catch {
      vscode.window.showErrorMessage(`DevSecOps Agent finding file does not exist on disk: ${filePath}`);
      return;
    }

    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);
    const lineNumber = finding.line_number ?? finding.line;

    if (lineNumber) {
      const line = Math.max(lineNumber - 1, 0);
      const position = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
  } catch (error) {
    showError(error);
  }
}

function isFinding(value: unknown): value is Finding {
  return typeof value === "object" && value !== null && "title" in value;
}

function showError(error: unknown): void {
  if (error instanceof BackendRunnerError) {
    vscode.window.showErrorMessage(error.message);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  vscode.window.showErrorMessage(`DevSecOps Agent failed. ${message}`);
}

async function applyViewFilter(
  resultsView: vscode.TreeView<unknown>,
  findingsProvider: FindingsProvider,
  applyFilter: () => void
): Promise<void> {
  applyFilter();
  await updateViewPresentation(resultsView, findingsProvider);
}

async function updateViewPresentation(
  resultsView: vscode.TreeView<unknown>,
  findingsProvider: FindingsProvider
): Promise<void> {
  const state = findingsProvider.getViewState();
  resultsView.message = buildViewMessage(state);

  await Promise.all([
    vscode.commands.executeCommand("setContext", "devsecopsAgent.hasScanned", state.hasScanned),
    vscode.commands.executeCommand("setContext", "devsecopsAgent.isScanning", state.isScanning),
    vscode.commands.executeCommand("setContext", "devsecopsAgent.filteredEmpty", state.filteredEmpty),
    vscode.commands.executeCommand("setContext", "devsecopsAgent.hasAnyFindings", state.hasAnyFindings)
  ]);
}

function buildViewMessage(state: FindingsViewState): string | undefined {
  if (state.isScanning) {
    return undefined;
  }

  if (!state.hasScanned) {
    return undefined;
  }

  if (!state.hasAnyFindings) {
    return undefined;
  }

  return undefined;
}

function logScanReport(output: vscode.OutputChannel, report: import("./backendRunner").ScanReport): void {
  output.appendLine(`Backend executable: ${report.backendPath}`);
  output.appendLine(`JSON report path: ${report.reportPath}`);
  output.appendLine(`Backend exit code: ${report.exitCode}`);
  output.appendLine(`Bundled Semgrep path: ${report.semgrepPath ?? "not provided"}`);
  output.appendLine(`Bundled Gitleaks path: ${report.gitleaksPath ?? "not provided"}`);
  output.appendLine(`Total findings: ${report.totalFindings}`);

  if (report.scannerExecutions.length > 0) {
    output.appendLine("Scanner execution statuses:");
    for (const execution of report.scannerExecutions) {
      output.appendLine(`- ${execution.scannerName}: ${execution.status}`);
      if (execution.command) {
        output.appendLine(`  command: ${execution.command}`);
      }
      if (execution.message) {
        output.appendLine(`  message: ${execution.message}`);
      }
    }
  }
}

async function focusResultsView(): Promise<void> {
  try {
    await vscode.commands.executeCommand("workbench.view.explorer");
    await vscode.commands.executeCommand(`${resultsViewId}.focus`);
  } catch {
    // The view is still populated even if VS Code cannot focus it.
  }
}
