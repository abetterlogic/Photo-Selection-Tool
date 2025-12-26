
# 📷 DSLR Photo Copier Tool


A powerful Electron-based desktop application that efficiently copies DSLR photos from multiple source folders based on CSV mappings. Perfect for photographers managing large photo libraries across multiple cameras and folders.


## Features

- **CSV-Driven Folder Mapping**: Define folder relationships in a CSV file for batch operations
- **Per-Folder Scanning**: Individually scan and verify photos before copying
- **RAW File Support**: Optionally include RAW variants (CR2, NEF, ARW, DNG, etc.) alongside standard formats
- **Collision Handling**: Smart prompts for file overwrite decisions (Overwrite/Skip/Overwrite All/Skip All)
- **Sequential Copying**: Copy photos one-by-one with live progress tracking (no batching, every file in your CSV is processed in order)
- **Dark Mode UI**: Modern, flat design with responsive layout
- **Cross-Platform**: Builds for Windows, macOS, and Linux
- **Developer-Friendly**: Context isolation, secure IPC, no DevTools in production


## Installation

### From Release Installers

Download the latest installer for your platform:
- **Windows**: `DSLR Photo Copier Tool-*.exe` (NSIS installer)
- **macOS**: `DSLR Photo Copier Tool-*.dmg` (DMG image)
- **Linux**: `dslr-photo-copier-tool-*.AppImage` or `.deb` package

### Development Setup

```bash
# Install dependencies with pnpm
pnpm install

# Run in development mode
pnpm start

# Build installers for your platform
pnpm build

# Build for all platforms (may require cross-compilation)
pnpm build:all
```


## How to Use

### 1. Prepare a CSV File

Create a CSV with column headers for folder names:

```csv
FolderName,Destination
Camera1,/path/to/camera1/source
Camera2,/path/to/camera2/source
...
```

Supported header names: `FolderName`, `folder_name`, `folderName`, or `Folder`

### 2. Select CSV in App

- Click **Upload CSV** and select your CSV file
- The app displays the file path and total photo count across all folders

### 3. Map Source Folders

For each folder in your CSV:
- Click **Choose** to select the source folder on disk
- Click **Scan** to verify photos and preview matched/missing files

### 4. Set Destination & Copy

- Choose a destination folder
- Optionally check **Include RAW files** to copy RAW variants
- Click **Copy Photos** to start the batch operation
- Monitor progress with the live progress bar and file counter

### 5. View Help

- **On Page**: Click the **💡 How To** button in the header to open documentation
- **In Menu**: Select **Help → Documentation** from the application menu

## Supported Photo Formats

**Standard Formats**: JPG, JPEG, PNG, HEIC

**RAW Formats**: RAW, CR2, NEF, ARW, RW2, DNG

When "Include RAW files" is enabled, the app searches for RAW variants in the source folder and includes them in the copy operation.


## Building & Packaging

### Prerequisites

- **Node.js** v16+ 
- **pnpm** v8+
- **Python** (for some build dependencies on certain platforms)

### Build Targets

- **Windows**: NSIS installer (`.exe`)
- **macOS**: DMG image (`.dmg`)
- **Linux**: AppImage and deb packages (`.AppImage`, `.deb`)

### Custom Icons

To customize the app icon, replace or add image files in the `assets/` folder:
- `icon.png` - Used for UI display (40x40px recommended)
- `icon.icns` - macOS app icon
- `icon.ico` - Windows app icon

### Build Commands

```bash
# Build for current platform only
pnpm build

# Attempt build for all platforms (requires compatible toolchain)
pnpm build:all
```


## Architecture

- **Main Process** (`src/main.js`): Electron app window, menu, and IPC handlers
- **Preload** (`src/preload.js`): Secure context bridge exposing `dslrAPI`
- **Renderer** (`src/renderer/renderer.js`): UI logic and event handling
- **Core Processor** (`src/core/processor.js`): CSV streaming, folder mapping, and job orchestration
- **Worker** (`src/core/worker.js`): File copy operations using Node worker threads

### Security Features

- **Context Isolation**: Renderer cannot access Node.js APIs directly
- **Secure IPC**: Main process validates all requests from renderer
- **No DevTools**: DevTools disabled in production builds
- **Content Security Policy**: Restricts script execution to safe sources


## Development Notes

- CSV parsing uses `csv-parse` with streaming for efficient large-file handling
- Photo copying uses Node.js `worker_threads` for non-blocking I/O
- UI updates via IPC progress callbacks for real-time feedback
- Collision prompts are synchronous during copy-only operations


## Troubleshooting

**App won't start**: Ensure all dependencies are installed with `pnpm install`

**Photos not found**: Verify your CSV folder names match exactly (case-sensitive on macOS/Linux)

**Build fails**: Check that you have the required platform build tools installed (Windows: Visual Studio Build Tools, macOS: Xcode Command Line Tools)


## License

See LICENSE file for details.


## Author & Support

- **Author:** Nishant Pandey (<info@dslr.app>)
- For help using the tool, click the **💡 How To** button in the app header or visit the documentation site.
- For direct support, email: info@dslr.app
