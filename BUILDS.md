# RJAF Flight Hours System — Build Targets

This repo produces three artefacts for operational use:

| Target              | Platform | How it's built                 | Output |
|---------------------|----------|--------------------------------|--------|
| Squadron Ops PC app | Windows  | electron-builder (NSIS)        | `RJAF-SquadronOps-Setup-<ver>.exe` |
| Pilot Logbook iOS   | iPhone   | EAS Build (preview/production) | `.ipa` |
| Pilot Logbook Android| Any     | EAS Build (preview APK)        | `.apk` |

All three are fully wired. Replit Linux cannot itself produce a Windows
installer or a real IPA/APK — those require Windows and macOS build hosts
respectively. Instead, this repo ships two GitHub Actions workflows that
do the heavy lifting for you.

---

## 1) PC app — Windows `.exe` installer

### Build via GitHub Actions (recommended)
1. Push this repo to GitHub.
2. In the Actions tab, run **Build Windows Installer (RJAF Squadron Ops)**.
3. When it finishes, download the `RJAF-SquadronOps-Installer` artefact —
   it contains the `.exe` you hand to ops officers.

Optional repo secrets:
- `INSTALL_PASSWORD` — master password the NSIS installer will prompt for
  before any files are written. Defaults to `rjaf-install-change-me`.

### Build manually on a Windows PC
See `artifacts/pilot-dashboard/ELECTRON_BUILD.md` for the full checklist.
Short version:
```powershell
cd artifacts/pilot-dashboard
pnpm install
pnpm add -D electron@^32 electron-builder@^25 electron-updater@^6
$env:INSTALL_PASSWORD="YourMasterPasswordHere"
pnpm run electron:build
# installer: artifacts/pilot-dashboard/release/RJAF-SquadronOps-Setup-<ver>.exe
```

### Publish the web copy (PWA)
Click **Publish** in Replit to deploy the dashboard as a PWA — same UI,
no install. Pair that URL with the `.exe` for ops officers who want a
desktop shortcut + offline cache.

---

## 2) Mobile app — IPA + APK

### Prerequisite (one-time)
1. Create a free Expo account at https://expo.dev/signup.
2. Generate an access token at
   https://expo.dev/accounts/[you]/settings/access-tokens.
3. Add it to this GitHub repo as a secret named **EXPO_TOKEN**.

### Build via GitHub Actions
1. Actions tab → **Build Mobile (IPA + APK)**.
2. Pick a profile:
   - **preview** — unsigned APK and iOS-simulator IPA. Good for internal
     testing without an Apple Developer account.
   - **production** — signed release APK and a real iPhone IPA. Requires
     an Apple Developer account (EAS will prompt the first time).
3. Build progress is visible at https://expo.dev/accounts/[you]/projects.
4. When the build finishes, EAS provides direct download links for the
   `.ipa` and `.apk`.

### Build locally (faster iteration)
```bash
cd artifacts/pilot-mobile
pnpm install
pnpm dlx eas-cli login
pnpm dlx eas-cli build --platform all --profile preview
```

### Common "build failed" causes we already handle
- **Android adaptive icon missing** → configured in `app.json`.
- **iOS bundle identifier missing** → `com.rjaf.pilotlogbook`.
- **Android package missing** → `com.rjaf.pilotlogbook`.
- **New architecture flag** → `newArchEnabled: true`.

If EAS still fails, the logs at https://expo.dev will tell you exactly
which step broke — usually a credentials prompt on first run that the
`--non-interactive` CI run can't answer. Run it once locally
(`eas build --platform ios --profile production`) to generate the
credentials, then re-run CI.

---

## Version bumps
- PC app: bump `version` in `artifacts/pilot-dashboard/package.json`.
- Mobile: bump `expo.version`, `ios.buildNumber`, `android.versionCode`
  in `artifacts/pilot-mobile/app.json`.

Tag a release (`git tag v1.0.1 && git push --tags`) to kick off both
CI builds at once.
