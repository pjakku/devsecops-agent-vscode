import * as path from "path";
import * as vscode from "vscode";
import { BackendRunner, BackendRunnerError, Finding } from "./backendRunner";
import { FindingsProvider } from "./findingsProvider";

const resultsViewId = "devsecopsAgent.results";

export function activate(context: vscode.ExtensionContext): void {
  const backendRunner = new BackendRunner(context);
  const findingsProvider = new FindingsProvider();
  const resultsView = vscode.window.createTreeView(resultsViewId, {
    treeDataProvider: findingsProvider,
    showCollapseAll: true
  });

  context.subscriptions.push(
    resultsView,
    vscode.commands.registerCommand("devsecopsAgent.scanWorkspace", () => scanWorkspace(backendRunner, findingsProvider)),
    vscode.commands.registerCommand("devsecopsAgent.refreshResults", () => scanWorkspace(backendRunner, findingsProvider)),
    vscode.commands.registerCommand("devsecopsAgent.showOnlySemgrepFindings", () => findingsProvider.showSemgrepOnly()),
    vscode.commands.registerCommand("devsecopsAgent.showAllFindings", () => findingsProvider.showAll()),
    vscode.commands.registerCommand("devsecopsAgent.openFinding", (finding: unknown) => openFinding(backendRunner, finding))
  );
}

export function deactivate(): void {}

async function scanWorkspace(backendRunner: BackendRunner, findingsProvider: FindingsProvider): Promise<void> {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "DevSecOps Agent is scanning the workspace",
        cancellable: false
      },
      async () => {
        const workspaceFolder = backendRunner.getWorkspaceFolder();
        const report = await backendRunner.scanWorkspace();
        findingsProvider.setResults(report.findings, workspaceFolder);
        await focusResultsView();
        vscode.window.showInformationMessage(`DevSecOps Agent scan completed with ${report.findings.length} finding(s).`);
      }
    );
  } catch (error) {
    findingsProvider.clear();
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

async function focusResultsView(): Promise<void> {
  try {
    await vscode.commands.executeCommand("workbench.view.explorer");
    await vscode.commands.executeCommand(`${resultsViewId}.focus`);
  } catch {
    // The view is still populated even if VS Code cannot focus it.
  }
}
