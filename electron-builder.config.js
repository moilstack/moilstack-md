/**
 * electron-builder configuration.
 *
 * Kept out of package.json so mac.notarize.teamId can be sourced from the
 * APPLE_TEAM_ID env var instead of being committed to this open-source repo.
 */
module.exports = {
  appId: "com.moilstack.moilstack-md",
  productName: "moilstack-md",
  icon: "build/icons",
  copyright: "Copyright © 2026 MoilStack",
  directories: {
    output: "dist",
  },
  publish: {
    provider: "github",
    releaseType: "release",
  },
  fileAssociations: [
    {
      ext: "md",
      name: "Markdown File",
      description: "Markdown Document",
      icon: "src/assets/file-icon-md",
      role: "Editor",
      mimeType: "text/markdown",
    },
  ],
  win: {
    target: ["nsis", "zip"],
    icon: "src/assets/icon.ico",
    artifactName: "moilstack-md-${version}.${ext}",
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "moilstack-md",
    include: "build/installer.nsh",
  },
  appx: {
    publisher: "CN=MoilStack",
    publisherDisplayName: "MoilStack",
    identityName: "MoilStack.Markdown",
    applicationId: "MoilStackMarkdown",
    backgroundColor: "#6366f1",
    languages: ["en-US"],
  },
  mac: {
    category: "public.app-category.productivity",
    target: ["dmg", "zip"],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.inherit.plist",
    notarize: process.env.APPLE_TEAM_ID
      ? { teamId: process.env.APPLE_TEAM_ID }
      : false,
  },
  dmg: {
    sign: false,
  },
  linux: {
    target: ["AppImage", "deb"],
    maintainer: "MoilStack <support@moilstack.com>",
  },
};
