# MASTER PROMPT — Cross-Platform Electron Desktop CRUD Application

You are a senior Electron.js desktop application architect and full-stack developer.

I want you to develop a production-ready desktop application using:

- Electron.js
- React
- TypeScript
- Vite
- Tailwind CSS
- Node.js APIs only where required
- electron-builder for production packaging
- SQLite/local database only if required for the CRUD functionality
- Secure Electron IPC architecture
- ESLint + TypeScript strict mode
- Modern, actively maintained packages only

## PRIMARY OBJECTIVE

Build a reusable and scalable Electron desktop application that performs CRUD operations and is designed from day one to run reliably on:

### Windows
- Windows 10+
- Windows 11
- x64
- ARM64

### macOS
- Intel x64
- Apple Silicon ARM64

The application must NOT depend on software, libraries, APIs, binaries, shell commands, filesystem paths, or native modules that work only on one operating system unless there is absolutely no alternative.

The application should be architected so that future modules can be added without breaking Windows or macOS compatibility.

---

# VERY IMPORTANT DEVELOPMENT RULE

Before installing ANY npm package/library/module:

1. Check whether it is actively maintained.
2. Check its latest stable version.
3. Check its Node.js compatibility.
4. Check its Electron compatibility.
5. Check Windows compatibility.
6. Check macOS Intel compatibility.
7. Check macOS Apple Silicon compatibility.
8. Check whether it contains native dependencies.
9. Check whether prebuilt binaries exist for all required architectures.
10. Check whether the package has known Electron rebuild requirements.
11. Check whether the package is deprecated or abandoned.
12. Prefer official Electron APIs or standard Node.js APIs when they provide the required functionality.
13. Never install a package simply because it is popular or because an old tutorial recommends it.

If a package is outdated, deprecated, abandoned, incompatible, or unnecessary, DO NOT install it.

Explain the alternative and use a supported solution.

---

# CROSS-PLATFORM FIRST PRINCIPLE

Every feature must be developed with Windows and macOS compatibility in mind.

Never assume:

- Windows filesystem paths
- macOS filesystem paths
- Windows-only shell commands
- Unix-only shell commands
- Windows registry availability
- macOS-specific APIs
- Windows-specific APIs
- bash
- PowerShell
- CMD
- Linux utilities
- platform-specific environment variables

unless the code is explicitly isolated behind a platform abstraction.

Use Electron/Node APIs such as:

- app.getPath()
- path.join()
- path.resolve()
- os
- fs/promises
- process.platform
- process.arch
- Electron IPC

instead of hard-coded operating-system-specific implementations.

Example:

BAD:

C:\\Users\\User\\AppData\\MyApp

GOOD:

app.getPath("userData")

---

# ARCHITECTURE

Use this architecture:

electron/
├── main/
│   ├── main.ts
│   ├── windows/
│   ├── ipc/
│   ├── services/
│   ├── database/
│   └── platform/
│
├── preload/
│   └── preload.ts
│
├── renderer/
│   ├── components/
│   ├── pages/
│   ├── layouts/
│   ├── hooks/
│   ├── services/
│   ├── types/
│   └── utils/
│
├── shared/
│   ├── types/
│   ├── constants/
│   └── validation/
│
├── tests/
│
├── build/
│
├── docs/
│   └── CROSS_PLATFORM_DEVELOPMENT_GUIDELINES.md
│
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md

Keep Electron main-process code separate from React renderer code.

Do NOT expose Node.js APIs directly to the renderer.

Use preload + contextBridge + IPC.

---

# SECURITY REQUIREMENTS

Electron security must be treated as a first-class requirement.

Use:

- contextIsolation: true
- nodeIntegration: false
- sandbox where practical
- secure preload APIs
- validated IPC requests
- typed IPC contracts

Do NOT expose:

window.require
require()
Node.js fs
Node.js child_process
Node.js process
shell execution

directly to React components.

React components should communicate with Electron through controlled preload APIs.

---

# CRUD MODULE

Create a generic CRUD architecture that can later be reused for multiple entities.

For example, initially create a "Members" CRUD module.

Required operations:

- Create
- Read
- Update
- Delete
- Search
- Filter
- Pagination
- Sorting
- Form validation
- Loading state
- Empty state
- Error state
- Confirmation before destructive operations

Example:

Member:

{
  id,
  name,
  email,
  phone,
  status,
  createdAt,
  updatedAt
}

The CRUD architecture should be reusable.

Do not tightly couple the CRUD components to the Members module.

Create reusable components such as:

- DataTable
- SearchInput
- Filter
- Pagination
- Modal
- ConfirmDialog
- FormField
- Select
- Button
- LoadingState
- EmptyState
- ErrorState

---

# UI REQUIREMENTS

Use Tailwind CSS for all UI styling.

Do NOT introduce another CSS framework.

Use a consistent design system.

Create reusable Tailwind-based components.

The UI should be:

- clean
- modern
- responsive
- accessible
- keyboard friendly
- desktop optimized
- consistent
- lightweight

Avoid unnecessary animation libraries.

Do not install UI libraries unless there is a strong technical reason.

Prefer simple reusable React + Tailwind components.

---

# DATABASE

If local persistence is required, select a database solution that is actively maintained and supports:

- Windows x64
- Windows ARM64
- macOS Intel
- macOS Apple Silicon
- Electron

Before installing a database package, verify native-module compatibility.

Avoid native dependencies unless they are necessary.

If a native database dependency is selected:

- document why it is required
- document Electron rebuild requirements
- document supported architectures
- verify production packaging
- test it on Windows and macOS

Never assume a native npm package will automatically work with Electron.

---

# PLATFORM ABSTRACTION

If platform-specific functionality becomes necessary, isolate it.

Example:

electron/main/platform/

windows.ts
macos.ts
index.ts

Use:

process.platform

to select implementations.

Example concept:

if (process.platform === "win32") {
    // Windows implementation
}

if (process.platform === "darwin") {
    // macOS implementation
}

Do not spread platform-specific conditions throughout the entire application.

Create a common interface and platform-specific implementations.

---

# FILE SYSTEM

Never hard-code application storage locations.

Use Electron:

app.getPath("userData")

for application data.

Use:

path.join()

for path construction.

Never manually concatenate:

"/"
"\\"

for filesystem paths.

Do not assume the current working directory.

Do not assume the user's home directory structure.

---

# COMMAND EXECUTION

Do not use shell commands unless absolutely necessary.

Avoid relying on:

- bash
- sh
- PowerShell
- CMD
- grep
- sed
- awk
- Unix-only utilities
- Windows-only utilities

If command execution is absolutely necessary:

1. isolate it
2. detect platform
3. validate executable availability
4. handle errors
5. document platform requirements
6. provide an alternative when possible

Prefer Node.js/Electron APIs.

---

# NATIVE MODULE POLICY

Native npm modules require special review.

Before installing a native module, verify:

- Electron compatibility
- Node ABI compatibility
- Electron rebuild support
- Windows x64
- Windows ARM64
- macOS x64
- macOS ARM64
- packaging support
- signing/notarization implications

Do not add native dependencies casually.

If a pure JavaScript implementation exists and provides sufficient functionality, prefer it.

---

# DEPENDENCY POLICY

Every dependency must have a reason.

Before adding:

npm install <package>

perform a dependency review.

For every dependency document:

Package:
Purpose:
Version:
Maintainer status:
Last release:
Node compatibility:
Electron compatibility:
Windows support:
macOS support:
Native dependency:
Architecture support:
Alternative considered:

Avoid:

- deprecated packages
- abandoned packages
- packages with unresolved major compatibility issues
- unnecessary duplicate libraries
- packages that solve a problem already solved by Electron/Node/browser APIs

Do not blindly run:

npm install

with random packages suggested by old Stack Overflow answers or old tutorials.

---

# VERSION MANAGEMENT

Pin important production dependencies to known compatible versions.

Do not randomly upgrade Electron or major dependencies.

Before upgrading:

1. review release notes
2. review breaking changes
3. verify Node requirements
4. verify native modules
5. run tests
6. build Windows
7. build macOS
8. test production installers

Maintain a dependency upgrade process.

---

# ELECTRON VERSION

Use a currently supported stable Electron release.

Before selecting the Electron version:

- check official Electron documentation
- check supported Node version
- check Chromium version
- check supported operating systems
- check architecture support
- check security support/lifecycle

Do not use an old Electron version just because an old tutorial uses it.

Record the selected Electron version in:

docs/CROSS_PLATFORM_DEVELOPMENT_GUIDELINES.md

---

# BUILD SYSTEM

Use electron-builder for packaging.

Production targets should include:

Windows:

- NSIS installer
- x64
- arm64

macOS:

- DMG
- x64
- arm64
- optionally universal if appropriate

Do not assume one build artifact works for every architecture.

Create clear npm scripts such as:

npm run dev
npm run build
npm run build:win
npm run build:mac
npm run build:win:x64
npm run build:win:arm64
npm run build:mac:x64
npm run build:mac:arm64
npm run build:mac:universal

Only create scripts that are technically supported by the selected toolchain.

---

# CODE SIGNING

Prepare the application architecture for production code signing.

Windows:

- Authenticode signing

macOS:

- Apple Developer signing
- notarization

Do not hard-code certificates, passwords, API keys, or signing credentials.

Use environment variables or secure CI/CD secrets.

---

# AUTO UPDATE

Design the application so automatic updates can be added safely.

Do not implement an update mechanism using random third-party scripts.

The update architecture should support:

- version checking
- update download
- user notification
- safe installation
- rollback/error handling

Document the selected updater and its platform requirements.

---

# ERROR HANDLING

Every IPC call and major service must have proper error handling.

Never silently swallow errors.

BAD:

try {
   ...
} catch {}

GOOD:

try {
   ...
} catch (error) {
   logger.error(...)
   return {
      success: false,
      error: ...
   }
}

Do not expose sensitive internal errors to users.

---

# LOGGING

Create a centralized logging service.

Logs should work on Windows and macOS.

Do not write logs to hard-coded locations.

Use Electron's application data/log paths.

Avoid excessive logging that can cause:

- CPU usage
- RAM usage
- disk usage

Production logs should be controlled.

---

# PERFORMANCE

The application must remain lightweight.

Avoid:

- unnecessary polling
- infinite timers
- memory leaks
- excessive React re-renders
- duplicate API requests
- unnecessary background processes
- large dependencies for simple functionality
- unnecessary native modules

Use lazy loading where appropriate.

Clean up:

- event listeners
- timers
- subscriptions
- IPC listeners
- browser resources

---

# API COMMUNICATION

If the application communicates with a backend API:

Create a centralized API service.

Do not scatter fetch/axios calls across every React component.

Handle:

- timeout
- network failure
- authentication failure
- retry where appropriate
- loading state
- error state

Do not store sensitive credentials directly in renderer code.

---

# ENVIRONMENT VARIABLES

Separate:

development
staging
production

Never commit:

- API keys
- passwords
- tokens
- private certificates
- signing credentials

Do not assume `.env` files are secure storage for secrets inside a distributed Electron application.

---

# TESTING

Before considering any module complete, test:

### Functional

- Create
- Read
- Update
- Delete
- Search
- Filter
- Pagination
- Validation
- Error handling

### Electron

- Application startup
- Application shutdown
- Window creation
- Window closing
- IPC communication
- File storage

### Windows

- Windows x64
- Windows ARM64 if available

### macOS

- Intel
- Apple Silicon

### Production

Test the actual packaged installer, not only development mode.

---

# CROSS-PLATFORM QA CHECKLIST

Before merging any feature:

[ ] Works in development

[ ] Works in production build

[ ] Works on Windows

[ ] Works on macOS

[ ] No hard-coded filesystem path

[ ] No OS-specific shell dependency

[ ] No deprecated npm package

[ ] No unsupported native dependency

[ ] No unnecessary package installed

[ ] No Node.js API exposed to renderer

[ ] IPC is validated

[ ] Error handling exists

[ ] Loading state exists

[ ] Empty state exists

[ ] No obvious memory leak

[ ] No unnecessary polling

[ ] TypeScript passes

[ ] ESLint passes

[ ] Build passes

[ ] Existing features still work

---

# DOCUMENTATION REQUIREMENT

Create:

docs/CROSS_PLATFORM_DEVELOPMENT_GUIDELINES.md

This document must become the project's permanent development rulebook.

It must contain:

1. Supported operating systems
2. Supported CPU architectures
3. Electron version
4. Node.js version
5. React version
6. TypeScript version
7. Tailwind version
8. Build system
9. Packaging strategy
10. Dependency rules
11. Native dependency rules
12. Electron security rules
13. IPC rules
14. Filesystem rules
15. Platform abstraction rules
16. Database rules
17. API rules
18. Logging rules
19. Performance rules
20. Testing rules
21. Code signing rules
22. Auto-update rules
23. Dependency upgrade procedure
24. Release checklist

---

# IMPORTANT AI AGENT BEHAVIOR

Do not make architectural changes without explaining them.

Do not install packages automatically just because they make development easier.

Before installing a package, tell me:

- Why it is required
- Whether Electron already provides the functionality
- Whether Node.js already provides the functionality
- Whether the package is maintained
- Whether it supports Windows and macOS
- Whether it has native dependencies
- Whether it supports x64 and arm64

If there is a cross-platform risk, STOP and explain the risk before proceeding.

Do not replace an existing working library with another library without a reason.

Do not upgrade dependencies unnecessarily.

Do not use deprecated APIs.

Do not follow outdated tutorials.

Use official documentation for Electron and major dependencies whenever possible.

---

# DEVELOPMENT WORKFLOW

For every new feature follow:

1. Understand requirement
2. Inspect existing architecture
3. Check whether existing utilities/components can be reused
4. Check cross-platform compatibility
5. Check dependency requirements
6. Design implementation
7. Implement
8. Type-check
9. Lint
10. Run tests
11. Build application
12. Verify packaging
13. Review Windows compatibility
14. Review macOS compatibility
15. Check for memory/CPU issues
16. Update documentation
17. Provide implementation summary

---

# CRUD UI REQUIREMENT

Create a professional desktop CRUD interface containing:

Sidebar
Header
Page title
Search
Filters
Add button
Data table
Pagination
Edit action
Delete action
Create/Edit modal or page
Validation
Success notification
Error notification
Loading state
Empty state

Use Tailwind CSS.

Do not use unnecessary UI libraries.

The interface should be reusable for future modules.

---

# FINAL REQUIREMENT

The most important goal is:

BUILD FOR LONG-TERM CROSS-PLATFORM COMPATIBILITY.

Do not optimize only for "it works on my machine".

Every architectural and dependency decision must consider:

Windows + macOS
x64 + ARM64
Electron compatibility
Node compatibility
package maintenance
native module compatibility
production packaging
security
performance
future maintainability

If something is uncertain, research the current official documentation before implementing it.

At the end of development, provide:

1. Final architecture
2. Installed dependencies and why each is required
3. Cross-platform compatibility report
4. Known limitations
5. Build commands
6. Testing commands
7. Production release procedure
8. Contents of CROSS_PLATFORM_DEVELOPMENT_GUIDELINES.md
9. Any packages that require special attention during future upgrades