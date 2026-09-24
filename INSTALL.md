# Installing MoilStack .md

Pre-built installers are on the [Releases page](https://github.com/moilstack/moilstack-md/releases/latest).

| Platform | Format |
|---|---|
| Windows | NSIS installer, portable ZIP — or the [Microsoft Store](https://apps.microsoft.com/detail/9pp0mrt5lrk5?hl=en-US&gl=AZ) |
| macOS | DMG, ZIP |
| Linux | AppImage, DEB |

## Windows

The NSIS/ZIP installer isn't code-signed, so Windows SmartScreen may show **"Windows protected your PC"**. This is normal for an open-source project without a paid code-signing certificate — click **More info → Run anyway**.

To avoid the warning entirely, install from the [Microsoft Store](https://apps.microsoft.com/detail/9pp0mrt5lrk5?hl=en-US&gl=AZ) instead.

## Linux

**DEB** (Debian, Ubuntu, Mint, Pop!_OS, and other Debian-based distros):

```bash
sudo apt install ./moilstack-md_*.deb
```

**AppImage** (works on almost any distro — no installation required):

```bash
chmod +x moilstack-md-*.AppImage
./moilstack-md-*.AppImage
```

If it fails with a FUSE-related error (some newer distros, e.g. Fedora 41+, ship without FUSE2), either install FUSE:

```bash
# Fedora
sudo dnf install fuse fuse-libs
# Ubuntu/Debian
sudo apt install fuse
```

or run it without FUSE:

```bash
./moilstack-md-*.AppImage --appimage-extract-and-run
```

## Next step

Connect an AI model — see the [AI Setup Guide](AI_SETUP.md).
