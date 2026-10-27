# File Management

The side menu's **File Management** page has two cards. The phone talks to
Google Drive directly; there is no Akshar server.

- **Google Drive**: which Drive File Share uses.
  1. **Your own Google account**, if connected: uploads go to an
     **Akshar** folder in your Drive. It uses Google Sign-In with the
     `drive.file` scope, so the app sees only the files it created.
  2. Otherwise, **the shared Drive** from Settings → File Management. This is
     an OAuth client plus a refresh token plus a folder: the same values as
     the share-chat server's `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
     `GOOGLE_REFRESH_TOKEN` and `GOOGLE_DRIVE_FOLDER_ID`.
- **File Share**:
  - folders, with a breadcrumb and a New folder button
  - upload from the system file picker, with an optional description and a
    progress bar
  - per file: Share link (makes it "anyone with the link", then opens the
    share sheet), Open in Drive, Edit description, Delete (moves it to the
    Drive trash)

## Layers

```
FileManagementScreen → useGoogleAccount / useSharedDrive / useFileBrowser
  → driveRepository (features/files/repository)
  → services/api/googleDrive.ts (REST: list, create, resumable upload, patch, permissions)
```

- `googleAccountService` wraps `@react-native-google-signin/google-signin`
  (16.1.5).
- `pickFile` wraps `@react-native-documents/picker` (12.0.2).
- Shared Drive credentials live in native code: `DriveCredentialStore`
  stores them encrypted with an Android Keystore key, and `DriveTokenClient`
  exchanges the refresh token for access tokens. The JS wrapper is
  `features/capture/services/driveCredentials.service.ts`, because only that
  folder may use the native module.
- JS can save the credentials and read a status: client id, folder id and
  4-character hints. It never reads the secret or the refresh token, and it
  only receives short-lived access tokens.

## Setup

- **Shared Drive:** enter the four values in Settings → File Management →
  Shared Google Drive, then tap Test connection. Nothing else is needed.
- **Personal Google accounts (optional):** in the Google Cloud project, enable
  the **Google Drive API**. Then create an **Android** OAuth client with
  package `com.rnboilerplate` and the SHA-1 of the signing key.
  - Get the SHA-1 with `cd android && ./gradlew signingReport`.
  - Without this, Connect shows "Google sign-in isn't set up for this build"
    (Google's DEVELOPER_ERROR).
  - Add test users on the OAuth consent screen while the app is in testing.

## Security

- **What the refresh token gives:** access to that Drive's files for anyone
  who has it.
- **How it's protected:** it is encrypted at rest and never logged. It's
  still on the phone, though, so treat the phone like a key.
- **If it leaks:** rotate it in Google Cloud.
- **Delete is reversible:** files go to the Drive trash for 30 days.

## Permissions

No new Android permissions; `INTERNET` was already declared. The file picker
uses the system document UI, so no storage permission is needed.
