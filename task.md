# Task: Build a Production-Ready Floating Screen OCR Mobile App

Act as a senior React Native architect, Android developer, UI/UX designer, and OCR specialist. Modify my **existing React Native boilerplate project** to build a complete, attractive, production-ready mobile application that extracts text from the phone screen in Hindi, English, or a mixture of both languages.

**Important:** Do not create a separate project or discard the existing boilerplate. First inspect the repository, understand its architecture, and modify it incrementally while preserving working features.

## 1. Core Product Requirements

Build a lightweight Android-first application that lets users extract visible text from almost any other app using a floating button.

The complete user flow must be:

1. User opens the app and completes a one-time setup.
2. User selects their preferred OCR language and theme.
3. User grants the necessary Android permissions.
4. A floating action button appears above other apps when the user enables it.
5. User opens any supported app, such as a browser, PDF reader, messaging app, or shopping app.
6. User taps the floating button.
7. The application captures the permitted screen content, processes it using on-device OCR, and extracts the text.
8. The extracted text is automatically copied to the system clipboard.
9. Show a small, attractive success message, such as “Text copied successfully”.
10. Provide an option to open the main app to review, edit, copy, or share the extracted text.

The application must work without user registration, login, OTP, account creation, API credentials, or a backend server.

## 2. Existing Boilerplate Inspection

Before writing code:

- Inspect the complete project structure and existing `package.json`.
- Identify the React Native version, navigation library, TypeScript configuration, native Android configuration, existing UI components, and installed dependencies.
- Inspect the Android manifest, Gradle configuration, application entry point, and existing theme architecture.
- Reuse compatible dependencies and existing project conventions.
- Avoid upgrading React Native or replacing core libraries unless technically necessary.
- Create a concise implementation plan and then execute it.
- Do not stop after providing a plan or sample UI. Implement, test, and integrate the actual features.

If a requirement cannot be implemented using the existing dependencies, explain the technical constraint and implement the safest compatible alternative.

## 3. Floating Button and Screen Capture

Implement a native Android floating overlay that can remain visible while the user switches between applications.

Requirements:

- A beautiful, compact, circular violet floating button with a recognizable scan/text icon.
- Draggable positioning so users can move the button to any convenient screen edge.
- Persist its position locally and restore it when the overlay is enabled again.
- Support enabling and disabling the overlay from the main app and settings.
- Provide a clear permission onboarding flow for Android's “Display over other apps” permission.
- Handle Android screen-capture permissions correctly using MediaProjection or an appropriate compatible native implementation.
- Request screen capture consent through the supported Android system flow.
- Respect Android background execution, foreground service, notification, and lifecycle requirements for the target SDK.
- Use a native Android service/module if required for reliable overlay and screen capture behavior.
- Avoid unnecessary foreground services, persistent notifications, battery consumption, or background polling.
- Provide clear loading, success, failure, and permission-denied states.
- Prevent duplicate capture operations when the user taps repeatedly.
- Ensure the floating button does not intercept more screen touches than necessary.
- Allow the user to dismiss, hide, or reposition the overlay.
- Handle screen rotation, app restarts, service termination, and permission revocation gracefully.

**Important Android constraint:** Screen capture must use the supported Android capture-consent mechanism. Do not silently bypass system consent, accessibility protections, secure-screen restrictions, or app privacy restrictions. Explain and implement the supported capture flow for the target Android versions. Secure screens that Android blocks must remain unsupported.

## 4. OCR Engine and Language Selection

Implement offline OCR using a compatible on-device OCR engine. Prefer Google ML Kit Text Recognition with Latin and Devanagari support if the existing project can support it reliably; otherwise select a technically compatible alternative and document the trade-offs.

Provide three selectable OCR modes:

1. **English** — prioritize English and Latin-script text.
2. **Hindi** — recognize Hindi in Devanagari script.
3. **Hindi + English** — recognize mixed-language content in a single screenshot.

Example input:

`आपका Order Successfully Shipped हो गया है।`

Expected output:

`आपका Order Successfully Shipped हो गया है।`

Requirements:

- Process captured images locally on the device.
- Do not upload screenshots or OCR text to external servers.
- Optimize screenshot processing, image scaling, memory usage, and OCR execution time.
- Preserve meaningful line breaks and reading order where possible.
- Handle small fonts, mixed scripts, numbers, punctuation, and multiple text blocks.
- Provide graceful handling for blurry images, empty screens, unsupported scripts, and OCR failures.
- Avoid promising perfect recognition.
- Clearly document the language models or native recognition components required.
- If downloading OCR models is required, explain the installation and first-use requirements. Do not require API keys or user credentials.

Verify actual Hindi recognition capability before choosing an engine. Do not implement a language selector that merely changes a label without changing the OCR behavior.

## 5. Clipboard Integration

After a successful extraction:

- Automatically copy the complete recognized text to the Android system clipboard.
- Display a short confirmation using a native toast or an attractive lightweight notification.
- If no text is found, explain that no readable text was detected and do not overwrite the clipboard with empty content.
- Handle clipboard errors gracefully.
- Add a manual Copy button to the extracted-text screen.
- Add Select All, Edit, Share, and Clear actions.
- Preserve Hindi Unicode characters correctly.
- Avoid displaying sensitive extracted content in notifications or logs.

The primary interaction should be fast: tap floating button → OCR → clipboard copied.

## 6. Main App Screens

Implement the following screens with polished, production-quality UI.

### A. Home Dashboard

Include:

- Brand logo and application name.
- Clear heading: “Capture text from anywhere”.
- Large primary violet button to enable or disable the floating tool.
- Current overlay and permission status.
- Selected OCR language.
- A short, visual three-step usage guide.
- Recently extracted text entries.
- Quick access to Settings.
- Empty state when extraction history is unavailable.
- Clear permission onboarding and recovery actions.

The interface must be clean, modern, responsive, and easy for non-technical users.

### B. Extracted Text Screen

Include:

- Editable text area with proper Hindi and English rendering.
- Language and extraction-time metadata.
- Copy, Share, Edit, Select All, and Clear controls.
- A clear success state after copying.
- Readable line spacing and appropriate text scaling.
- Empty and error states.
- Accessible touch targets.

### C. Settings Screen

Organize settings into clear sections.

**OCR Settings**

- English
- Hindi
- Hindi + English
- Persist the selected language locally.
- Apply the selected language to subsequent OCR operations.

**Floating Button Settings**

- Enable/disable floating button.
- Display overlay permission status.
- Start or stop the overlay service.
- Configure button size and opacity where supported.
- Reset floating button position.
- Explain any system restrictions.

**Clipboard and History**

- Automatic clipboard copy toggle.
- Save extraction history toggle.
- Clear all history with a confirmation dialog.
- Provide a clear privacy explanation.

**Appearance**

- Open a dedicated Theme tab described below.

**About**

- App version.
- Privacy information.
- Permissions and their purposes.
- Troubleshooting instructions.

### D. Theme and Typography Tab

Create a dedicated appearance interface with two configurable dimensions: theme colors and text styles.

**Theme colors**

Provide attractive preset themes:

1. Violet — default primary theme.
2. Midnight Violet.
3. Ocean Blue.
4. Emerald.
5. Rose.
6. Amber.

Users must be able to preview and apply each theme.

**Theme architecture requirements**

- Build a centralized, strongly typed theme system.
- Define semantic tokens for primary, primary foreground, secondary, accent, background, surface, card, border, text primary, text secondary, placeholder, success, warning, error, overlay, and disabled states.
- Include light and dark mode support.
- Ensure every component obtains colors from the active theme rather than hardcoded color values.
- Update navigation bars, buttons, cards, icons, inputs, dividers, status indicators, dialogs, floating controls, and text dynamically.
- Maintain accessible text/background contrast.
- Persist the selected theme and mode locally.
- Apply changes immediately throughout the application without requiring a restart.
- Use safe defaults when a saved theme is missing or invalid.

**Two text styles only**

Provide exactly two selectable typography presets:

1. **Modern** — clean sans-serif typography, balanced spacing, and contemporary headings.
2. **Classic** — traditional, comfortable typography with a slightly more formal feel.

Apply the selected preset consistently to headings, body text, labels, buttons, settings rows, dialogs, and extracted text. Use fonts already available or bundled legally with the application. Ensure Hindi Devanagari glyphs render correctly; fall back to a compatible font when necessary.

Do not confuse typography presets with OCR language settings. Both must operate independently.

## 7. Visual Design System

Use a premium violet-first design language.

Suggested default tokens:

- Primary: `#7C3AED`
- Primary pressed: `#6D28D9`
- Light background: `#F8F7FC`
- Light surface: `#FFFFFF`
- Dark background: `#11101A`
- Dark surface: `#1C1928`
- Main text: `#211D2B`
- Secondary text: `#777184`
- Border: `#E8E3F0`
- Success: `#16A34A`
- Warning: `#D97706`
- Error: `#DC2626`

Treat these as initial defaults, not scattered hardcoded values. All UI colors must resolve through the active theme tokens.

Design requirements:

- Modern, elegant mobile UI.
- Consistent spacing, typography, radii, shadows, and iconography.
- Clear hierarchy and restrained use of gradients.
- Beautiful empty states and permission illustrations.
- Smooth but lightweight transitions.
- Subtle feedback for button taps, OCR processing, and successful clipboard copying.
- Avoid excessive cards, visual clutter, oversized headings, and unnecessary animations.
- Support small and large screens, Android system navigation, display cutouts, and accessibility font scaling.
- Use consistent icons from one compatible icon library.
- Make the settings screen especially intuitive and attractive.

Do not create only a static design prototype. All controls must work.

## 8. Technical Architecture

Follow a maintainable architecture suitable for future expansion.

- Use TypeScript with strict typing.
- Separate screens, reusable UI components, hooks, domain logic, theme tokens, persistence, OCR, clipboard operations, and Android-native functionality.
- Implement an appropriate native bridge or TurboModule-compatible approach if required by the current React Native version.
- Use a centralized permission manager.
- Use a dedicated OCR service abstraction.
- Use a centralized theme provider and typography provider.
- Use an appropriate lightweight local persistence solution already compatible with the boilerplate.
- Keep native Android responsibilities separate from React Native presentation logic.
- Define explicit types for OCR mode, OCR results, theme configuration, typography preset, overlay state, and extraction history.
- Use stable, documented dependencies and avoid unnecessary packages.
- Avoid circular imports, duplicate business logic, oversized components, and unsafe TypeScript casts.
- Keep components small and reusable; split files before they become difficult to maintain.
- Follow existing project naming conventions.
- Do not introduce a backend, account system, or unnecessary network requests.

## 9. Privacy and Security

The app must be credential-free and local-first.

- No signup or login.
- No API keys.
- No backend dependency.
- No analytics or advertising SDKs unless explicitly approved later.
- No screenshot uploads.
- No unnecessary permissions.
- No screenshot content in production logs.
- No hidden capture or consent bypass.
- Stop capture cleanly when disabled.
- Delete temporary screenshot data when no longer needed.
- Store history locally only when the user enables it.
- Explain that other apps may prevent screen capture or display protected content.

## 10. Performance Requirements

- Minimize idle battery and CPU usage.
- Do not continuously capture the screen while waiting for a button press.
- Do not repeatedly initialize the OCR engine unnecessarily.
- Avoid blocking the JavaScript UI thread during OCR.
- Release bitmap and image resources after processing.
- Prevent memory leaks and duplicate event listeners.
- Avoid unnecessary React re-renders.
- Ensure the floating service and React Native UI synchronize correctly.
- Handle app backgrounding and foregrounding without crashes.
- Test on a physical Android device as well as an emulator where possible.

## 11. Testing and Validation

Implement tests for the logic that can be tested independently.

Verify:

- English OCR selection.
- Hindi OCR selection.
- Mixed-language OCR selection.
- Clipboard copying of Hindi and English Unicode text.
- Empty OCR results.
- OCR failure recovery.
- Theme switching and persistence.
- Light/dark mode.
- Typography switching and persistence.
- Floating button enable/disable state.
- Permission-denied and permission-revoked cases.
- History enabled/disabled behavior.
- Service cleanup and app lifecycle handling.

Run available TypeScript checks, linting, tests, and Android build tasks. Fix regressions introduced by the implementation.

Do not claim that the app builds or works unless the corresponding checks have actually passed. Clearly report any unverified behavior.

## 12. Required Deliverables

Complete the implementation in the existing repository and provide:

1. A short summary of the existing architecture discovered.
2. A summary of implemented functionality.
3. The final project structure and important files changed.
4. Any Android manifest, Gradle, Kotlin, or native-module changes.
5. Required permissions and the reason for each.
6. Exact installation and development commands.
7. Exact steps to build a release APK.
8. Physical-device testing instructions.
9. Known Android limitations and any remaining blockers.
10. A concise checklist showing which features were implemented and tested.

## Final Instructions

Prioritize a fully functional Android implementation over superficial visual polish, while maintaining excellent UI quality.

Do not replace working boilerplate code unnecessarily. Do not silently break existing features. Do not invent unsupported React Native APIs or use obsolete Android service patterns.

First inspect the project, then implement the complete feature set incrementally, verify the result, and provide a working build path.

**Definition of done:** A user can install the Android app, enable the permitted floating button, select English, Hindi, or mixed-language OCR, tap the floating button over a supported app, extract readable screen text, and have it automatically copied to the clipboard. The user can also customize the app's theme colors and choose between exactly two typography presets, with all preferences persisting across restarts.
