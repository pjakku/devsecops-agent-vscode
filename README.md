# DevSecOps Agent VS Code Extension

This repository contains a VS Code extension MVP for `devsecops-agent-vscode`. It is intentionally separate from the Python CLI repository and does not recreate the Python package source tree.

The extension exposes:

- `DevSecOps Agent: Scan Workspace`
- `DevSecOps Agent: Refresh Results`
- `DevSecOps Agent: Show Only SAST Findings`
- `DevSecOps Agent: Show All Findings`
- A native sidebar Tree View named `DevSecOps Agent`

Scan results are grouped by severity. Findings show the title as the main label and include scanner, category, and file path details in the description or tooltip. Selecting a finding opens the referenced file and navigates to the finding line when one is available.

The `DevSecOps Agent` results view appears in the Explorer sidebar.

The extension runs the bundled `devsecops-agent` backend. Internal findings come from the agent's built-in scanners, such as `source_scanner`, `manifest_scanner`, and `dependency_scanner`. SAST findings are powered by Semgrep and are displayed as `SAST` when available.

Before the first scan, the empty `DevSecOps Agent` view shows welcome buttons for running a scan and switching filters. The view title toolbar keeps scan, refresh, show all findings, and show only SAST findings available before and after scan results are loaded. Depending on sidebar width, VS Code may place some toolbar actions in the view title overflow menu.

## Prerequisites For Extension Development

- Visual Studio Code
- Node.js and npm
- Extension dependencies installed with:

```powershell
npm.cmd install
```

On Windows, the VS Code tasks use `npm.cmd` so PowerShell execution policy does not block `npm.ps1`. If you run npm commands manually in PowerShell and see an execution policy error, use `npm.cmd` instead of `npm`.

## Run In Extension Development Host

1. Open this folder in VS Code.
2. Run `npm.cmd install` on Windows PowerShell, or `npm install` on macOS/Linux.
3. Run `npm.cmd run compile` on Windows PowerShell, or `npm run compile` on macOS/Linux.
4. Press `F5` or choose **Run Extension** from VS Code's Run and Debug view.
5. In the Extension Development Host window, open a workspace folder to scan.
6. Run `DevSecOps Agent: Scan Workspace` from the Command Palette or use the `DevSecOps Agent` sidebar scan button.

For watch mode during development, run:

```powershell
npm.cmd run watch
```

Then press `F5` from VS Code.

## Backend Executable Structure

The UI does not launch the backend directly. Backend execution is isolated in:

```text
src/backendRunner.ts
```

For the MVP, the runner expects a future bundled executable under:

```text
backend/devsecops-agent.exe
```

On Windows, SAST can be powered by a bundled Semgrep executable at:

```text
backend/semgrep/win/semgrep.exe
```

On macOS and Linux, it expects:

```text
backend/devsecops-agent
```

The backend runner currently prepares a temp JSON report path and executes:

```text
devsecops-agent scan <workspacePath> --json-out <tempReportPath>
```

After execution, it reads the generated JSON report and normalizes findings for the Tree View.

Backend exit code `1` means the scan completed and violated the backend fail threshold. The extension treats exit codes `0` and `1` as completed scans and loads the JSON report in both cases.

When the bundled Windows Semgrep executable is present, the extension passes its path to the backend through the scan process environment and prepends its folder to that process's `PATH`. This lets SAST run from the extension package without requiring users to install Semgrep separately.

## Where To Change Backend Path Resolution Later

Change backend path resolution in:

```text
src/backendRunner.ts
```

Specifically, update `resolveBackendExecutablePath()` if packaged backend files later need platform-specific folders, architecture-specific names, signed binaries, or a different layout.

## Extension Structure

```text
package.json              VS Code manifest, commands, Tree View contributions
tsconfig.json             TypeScript compiler settings
resources/                Extension activity bar icon
src/extension.ts          Extension activation, commands, and editor navigation
src/backendRunner.ts      Workspace detection, backend path resolution, execution, JSON loading
src/findingsProvider.ts   Native Tree View provider grouped by severity
backend/                  Future bundled backend executable location
backend/semgrep/win/      Future bundled Windows Semgrep executable location
```

## Future Features

The MVP leaves room for:

- Severity filtering in the Tree View
- Scan current file
- Jenkins and GitHub Actions references
- Marketplace packaging and publishing
