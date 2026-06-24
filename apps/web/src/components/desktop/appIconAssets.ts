const MACOS_APP_ICON_SRC: Record<string, string> = {
  "ai-chat": "/icons/macos/ai-chat.png",
  "file-manager": "/icons/macos/file-manager.png",
  notes: "/icons/macos/notes.png",
  "document-editor": "/icons/macos/document-editor.png",
  "text-editor": "/icons/macos/text-editor.png",
  calendar: "/icons/macos/calendar.png",
  mail: "/icons/macos/mail.png",
  whiteboard: "/icons/macos/whiteboard.png",
  browser: "/icons/macos/browser.png",
  terminal: "/icons/macos/terminal.png",
  settings: "/icons/macos/settings.png",
  launcher: "/icons/macos/launcher.png",
};

export function getMacosAppIconSrc(appId: string): string | undefined {
  return MACOS_APP_ICON_SRC[appId];
}
