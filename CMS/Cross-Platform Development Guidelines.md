# Cross-Platform Development Guidelines

## 1. Purpose

This document defines the mandatory development standards for this Electron application.

The application must remain compatible with supported Windows and macOS systems throughout its lifecycle.

No feature should be implemented in a way that unnecessarily introduces operating-system or CPU-architecture dependencies.

---

## 2. Supported Platforms

### Windows

- Windows 10+
- Windows 11
- x64
- ARM64

### macOS

- Intel x64
- Apple Silicon ARM64

The exact minimum OS versions must be reviewed against the selected Electron version before each major upgrade.

---

## 3. Technology Stack

The project uses:

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS
- Node.js
- electron-builder

Versions must be recorded in `package.json` and reviewed before major upgrades.

---

## 4. Dependency Rules

Before installing a package, verify:

- Active maintenance
- Latest stable release
- Node.js compatibility
- Electron compatibility
- Windows compatibility
- macOS compatibility
- x64 compatibility
- ARM64 compatibility
- Native dependency requirements
- Electron rebuild requirements
- License
- Known security issues

Prefer built-in Electron, Node.js, browser APIs, or existing project utilities over adding another dependency.

Never install deprecated or abandoned packages.

---

## 5. Native Dependency Rules

Native modules are high-risk for cross-platform compatibility.

A native package may only be introduced after confirming:

- Electron ABI compatibility
- Windows x64 support
- Windows ARM64 support
- macOS x64 support
- macOS ARM64 support
- Production packaging support

If a pure JavaScript alternative provides sufficient functionality, prefer it.

---

## 6. Filesystem Rules

Never hard-code paths.

Never assume:

`C:\Users\...`

or:

`/Users/...`

Use Electron APIs such as:

`app.getPath("userData")`

and Node's:

`path.join()`

for filesystem operations.

---

## 7. Platform-Specific Code

Platform-specific code must be isolated.

Use:

`process.platform`

and:

`process.arch`

when platform or architecture detection is required.

Do not spread platform-specific conditions throughout React components.

Use a platform abstraction layer.

---

## 8. Electron Security

The application must use:

- contextIsolation
- disabled renderer Node integration
- secure preload
- controlled IPC
- validated IPC input

React must never receive unrestricted access to Node.js APIs.

---

## 9. IPC

All communication between renderer and main process must go through controlled IPC methods.

IPC handlers must:

- validate input
- handle errors
- return predictable results
- avoid exposing unnecessary system capabilities

---

## 10. UI

Tailwind CSS is the primary styling system.

Avoid adding multiple CSS frameworks.

Use reusable components.

All common UI patterns should be standardized.

---

## 11. Performance

Avoid:

- unnecessary polling
- memory leaks
- excessive timers
- unnecessary background processes
- duplicate requests
- large unnecessary dependencies

Always clean up listeners and timers.

---

## 12. Testing

Every feature must be tested in:

- development mode
- production build
- Windows
- macOS

Where possible, test:

- Windows x64
- Windows ARM64
- macOS Intel
- macOS Apple Silicon

Testing only in development mode is not sufficient.

---

## 13. Packaging

Production builds must generate appropriate installers for the target platforms.

Windows:

- NSIS
- x64
- ARM64

macOS:

- DMG
- x64
- ARM64

Universal macOS builds may be produced where appropriate.

---

## 14. Code Signing

Production releases should use:

### Windows

Authenticode signing.

### macOS

Apple Developer signing and notarization.

Signing credentials must never be committed to source control.

---

## 15. Dependency Updates

Do not update dependencies automatically without review.

Before a major update:

1. Read release notes.
2. Check breaking changes.
3. Check Electron compatibility.
4. Check Node compatibility.
5. Check native dependencies.
6. Run tests.
7. Build Windows.
8. Build macOS.
9. Test production installers.

---

## 16. New Feature Checklist

Before merging a feature:

- [ ] Cross-platform compatible
- [ ] No hard-coded paths
- [ ] No unnecessary dependency
- [ ] No deprecated dependency
- [ ] No unsupported native module
- [ ] IPC secured
- [ ] Error handling implemented
- [ ] Loading state implemented
- [ ] Empty state implemented
- [ ] TypeScript passes
- [ ] ESLint passes
- [ ] Tests pass
- [ ] Production build passes
- [ ] Existing functionality verified

---

## 17. Golden Rule

Never make a decision based only on:

"It works on my computer."

Every decision must consider:

Windows + macOS  
x64 + ARM64  
Electron compatibility  
Node compatibility  
Package maintenance  
Security  
Performance  
Production packaging  
Long-term maintainability