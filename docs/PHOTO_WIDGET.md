# Photo Widget

Sidebar → **Photo Widgets**. Real Android home-screen widgets (`AppWidgetProvider`)
that show your photos, as many as you like.

## What it does

- **New photo widget:** opens the system photo picker (no storage or gallery
  permission). The photo is copied into private app storage.
- **Editor:**
  - **Live preview:** the same maths as the widget renderer.
  - **Size:** *Match widget* (fill whatever size the widget has), or *Custom size*.
    Drag the preview's corner handle to set width × height in cells (1–4 each). The
    handle is also adjustable with a screen reader.
  - **Display:** *Fit* (whole photo), *Fill* (cover, centred), or *Crop* (drag the
    photo to choose what shows, and zoom 1–4×).
  - **Rounded corners, name, Replace photo, Remove.**
  - **Add to home screen:** `requestPinAppWidget`, with a fallback hint when the
    launcher doesn't support it.
- **From the launcher:** long-press the home screen → Widgets → Akshar → Photo. A
  dialog asks which photo (or a new one). Long-press → settings (pencil) picks a
  different photo later.
- **Resizing:** long-press a placed widget and drag its handles. The photo is
  redrawn at the new size (`onAppWidgetOptionsChanged`).
- **Taps:** tapping a widget opens its editor (`rnboilerplate://photo-widgets/<id>`).
  A widget whose photo was removed shows "Tap to choose a photo".

## How it works

- **Native is the source of truth** (`PhotoWidgetStore`, SharedPreferences). It
  holds the settings and which placed widget (`appWidgetId`) shows which setting,
  because the launcher asks the provider directly, even right after a reboot.
- **Photos are stored as files** in `files/photo_widgets/`, never in the settings:
  - kept upright, at most 2048 px, JPEG — or PNG when the photo has transparency
  - unused files are deleted after each save or remove
  - a replacement photo that was never saved is discarded when the editor closes
- **Rendering** (`PhotoImages.render`, `PhotoMath.layout`):
  - The photo is drawn natively into a bitmap at the widget's real size. Fit, fill,
    crop and rounded corners are applied there.
  - It decodes only the resolution needed and caps the bitmap at 900 px, because
    RemoteViews have a strict memory budget.
  - It runs on a background thread (`goAsync`).
- `services/layout.ts` mirrors `PhotoMath.kt`, and both are tested with the same
  cases.

## Files

- **JS:** `src/features/photoWidget/` contains:
  - `screens/PhotoWidgetsScreen`, `screens/PhotoWidgetEditScreen`
  - `components/PhotoPreview`
  - `hooks/usePhotoWidgets`
  - `services/native.service.ts`, `services/layout.ts`
- **Spec:** `src/specs/NativePhotoWidget.ts`.
- **Native:** `android/.../photowidget/` contains `PhotoWidgetProvider`,
  `PhotoWidgetConfigureActivity` (+ `PhotoWidgetPinReceiver`), `PhotoWidgetModule`,
  `PhotoWidgetStore`, `PhotoImages` and `PhotoMath`.
- **Resources:** `res/layout/photo_widget.xml`, `res/xml/photo_widget_info.xml`
  (resizable down to one cell, `reconfigurable`), and
  `res/drawable/photo_widget_empty_bg.xml`.

## Permissions

None. The system photo picker needs no permission, and widgets need none.

## Tests

- `src/features/photoWidget/__tests__/photoWidget.test.tsx`:
  - layout (fit / fill / crop / shape / placement / drag)
  - validation
  - the list screen (create, import error)
  - the editor (mode, shape, crop zoom, corners, resize handle, replace + pin,
    discard unsaved photo, remove, missing widget)
- `android/.../photowidget/PhotoMathTest.kt`: the same layout cases, sample size and
  config validation.
- **Verified on an Android 15 emulator:**
  - picked a photo, then *Add to home screen* → launcher dialog → widget placed
  - resized with the handles and the photo was redrawn
  - Fit + custom 3 × 1 shape updated the placed widget
  - added a second widget from the launcher's widget list (configure dialog)
  - rebooted and both widgets still showed the photo

## Known limitations

- Android doesn't let an app set a placed widget's size; only the launcher can
  (drag the handles). The custom size sets the photo's shape inside the widget.
- Some launchers report sizes slightly differently; the photo is always drawn to
  the size the launcher reports.
- Widgets show one photo each; there's no slideshow.
