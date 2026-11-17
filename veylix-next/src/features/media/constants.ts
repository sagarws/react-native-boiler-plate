// @ts-nocheck

export const mediaLibraryFilters = [
  "All files",
  "Images",
  "Documents",
  "Video & audio",
  "Starred",
];

export const MEDIA_TRASH_FOLDER = "Trash";

export const mediaReservedFolders = new Set([
  ...mediaLibraryFilters,
  MEDIA_TRASH_FOLDER,
]);
