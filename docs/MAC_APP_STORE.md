# Mac App Store Build and Submission Guide

## Current status

The repository now has a separate Mac App Store build path:

- `electron-builder-mas.json5` builds a sandboxed `mas` package and a runnable `mas-dev` test build.
- `build/entitlements.mas.plist` and `build/entitlements.mas.inherit.plist` provide App Sandbox entitlements.
- MAS builds no longer execute LibreOffice; legacy `.doc`/`.ppt` conversion reports an explicit limitation, while legacy `.xls` previews natively via SheetJS.
- `scripts/mas-preflight.mjs` checks the profile, entitlements, and signing identities before a build.
- `scripts/validate-mas-build.sh` validates the produced `.app`/`.pkg` on macOS.
- `.github/workflows/mas.yml` is a manual build-and-validate workflow with a separate upload switch.
- `docs/MAS_TEST_PLAN.md` is the required macOS test checklist.

The first macOS GitHub Actions run [45201665607](https://github.com/ConfiShare/confi-share-desktop/actions/runs/45201665607) built the universal `.app` and signed `.pkg` successfully. Its automated validation passed architecture, app/helper signatures, sandbox entitlements, bundle identity, provisioning profile, and package signature. The app has **not** yet been interactively tested on a Mac, uploaded to App Store Connect, or submitted for review.

### Source audit

- `package-lock.json` pins Electron 40.4.1 and electron-builder 26.16.1; the package manager is npm. `npm run build:win` compiles TypeScript, builds Vite renderer/main/preload outputs, and packages an NSIS x64 installer under `release/<version>/`. `.github/workflows/release.yml` also builds signed/notarized DMGs for direct distribution; it is separate from the MAS workflows.
- The user signs in or creates/verifies an account, then imports `.cdc`, ZIPs containing `.cdc`, PDF, Office/OpenDocument, text, or image files. Imported bytes are copied to `app.getPath('userData')/stored_docs`; the list is stored in `documents.json`. Protected `.cdc` files are decrypted with an access code, activated against `https://server.confishare.io/api/v1`, and can be reopened within the server-issued offline window. `safeStorage` encrypts the cached account session, device ID, and DRM activation data in `secure_metadata.json` using the operating system's secure storage.
- Native document previews use PDF.js, SheetJS, and JavaScript Office parsers. The alternative Office-to-PDF path launches LibreOffice on Windows/direct-distribution macOS builds. The MAS guard prevents any `soffice` launch; unsupported legacy `.doc` and `.ppt` files show a conversion limitation. The app has no native runtime Node modules or bundled LibreOffice binary in the configured `files` list. Vite's Rollup, Lightning CSS, and Tailwind native packages are build-time optional dependencies present in the lockfile for both Mac CPU types.
- The main process blocks browser downloads, print/save shortcuts, external navigation, and popup windows. The document viewer requests content protection while open, but macOS capture protection has limits described below. There is no self-updater in this codebase; App Store installs will receive updates through Apple.

## Keep the two release paths separate

| Path | Config | Signing | Output |
| --- | --- | --- | --- |
| GitHub DMG releases | `electron-builder.json5` | Developer ID Application + notarization | signed/notarized DMG |
| Mac App Store | `electron-builder-mas.json5` | Mac App Distribution + Mac Installer Distribution | `.pkg` for App Store Connect |

Do not reuse the Developer ID certificate, notarization credentials, or `dmg` settings for MAS. The MAS config intentionally sets `notarize: false`, does not configure `dmg`, and uses separate entitlements.

## 1. Verify the bundle ID

The user reports registering the explicit App ID `io.confishare.mac` in Apple Developer and creating its macOS App Store Connect app record. The Mac App Store build now uses this ID. The public name remains `ConfiShare` in the build until the user confirms the listing name. The Mac App Distribution and Mac Installer Distribution certificates downloaded on 23 November 2026 identify Apple Developer Team ID `Q2QWZHNNMX` (CYPRIAN CHIMA OCHI); both public keys match their local private keys. Both certificates expire on 23 November 2027. The downloaded distribution profile also matches the App ID, team, and app certificate, and expires on 23 November 2027. Its entitlement includes the team-scoped App Groups wildcard `Q2QWZHNNMX.*`. Both `.p12` exports and the profile have been installed as repository Actions secrets. Local export passwords are backed up in Windows DPAPI-encrypted files under the ignored `mas-signing/` directory; decrypting them requires this Windows user account.

Check both places:

1. Apple Developer > Certificates, Identifiers & Profiles > Identifiers.
2. App Store Connect > Apps.

An explicit App ID is required for a Mac App Store provisioning profile. The MAS ID `io.confishare.mac` is intentionally distinct from the existing Developer ID DMG and Windows ID `com.confishare.desktop`. If Apple reports an ID conflict, choose an available ID and update:

- `electron-builder-mas.json5`: `appId`, `mas.appId`, `masDev.appId`, `helperBundleId`
- the provisioning profile
- the App Store Connect app record

The portal registration is user-reported; this Windows workspace cannot independently inspect the Apple account.

If an existing App Store Connect app already uses this bundle ID, add **macOS** under that app only if you intend a universal purchase with shared app identity and SKU. Otherwise create a separate macOS app record with its own available bundle ID. Do not create a duplicate record for the same bundle ID.

**Apple Developer browser path:** Certificates, Identifiers & Profiles > Identifiers > **+** > **App IDs** > Continue > **App** > Continue. Set Description to `ConfiShare macOS`, choose **Explicit App ID**, set Bundle ID to the confirmed ID, review capabilities, then **Continue** > **Register**. Reuse a matching existing explicit ID if one exists.

**App Store Connect browser path:** Apps > **+** > **New App**. Select **macOS**, enter the confirmed public **Name**, **Primary Language** (choose your actual supported language), confirmed **Bundle ID**, unique internal **SKU** (for example `CONFISHARE-MAC-001` if available), and **User Access** (Full Access, or Limited Access with your selected users). Click **Create**. If adding macOS to an existing multi-platform app, open that app and use **Add Platform** > macOS instead.

## 2. Apple Developer items you must provide

### Signing certificates

Create or obtain:

- **Mac App Distribution** certificate.
  - Keychain may display it as `3rd Party Mac Developer Application: ...`.
- **Mac Installer Distribution** certificate.
  - Keychain may display it as `3rd Party Mac Developer Installer: ...`.
- For local sandbox testing: an **Apple Development** or **Mac Developer** certificate.

Export each certificate **with its private key** as a separate `.p12` (recommended):

- `mas-app.p12`: Mac App Distribution certificate + private key.
- `mas-installer.p12`: Mac Installer Distribution certificate + private key.

On a Mac:

1. Open Keychain Access > My Certificates.
2. Select one certificate and its private key.
3. Export as `.p12`.
4. Set a strong export password.
5. Repeat for the installer certificate.

electron-builder 26 accepts the app identity through `CSC_LINK` and the installer identity through `CSC_INSTALLER_LINK`. The CI workflow requires two separate password-protected `.p12` files.

Keep the Developer ID certificates out of these `.p12` files so the App Store build and DMG release credentials remain separate.

#### Creating certificates without a Mac

You can create the CSR and `.p12` on Windows with OpenSSL. Check `openssl version` in PowerShell first; install a trusted Windows OpenSSL distribution or use Git for Windows' bundled binary if it is available on your PATH. OpenSSL is not currently on this workspace's PowerShell PATH.

This workspace already has ignored `mas-signing/mas-app.csr`, `mas-signing/mas-app.key`, `mas-signing/mas-installer.csr`, and `mas-signing/mas-installer.key`. If they match certificates already issued in your Apple account, reuse them. Do not regenerate a key after Apple has issued its matching certificate. Store any new signing files in an encrypted location outside git and never commit them.

```powershell
openssl req -new -newkey rsa:2048 -nodes -keyout mas-app.key -out mas-app.csr -subj "/CN=ConfiShare MAS App"
openssl req -new -newkey rsa:2048 -nodes -keyout mas-installer.key -out mas-installer.csr -subj "/CN=ConfiShare MAS Installer"
openssl req -new -newkey rsa:2048 -nodes -keyout mas-dev.key -out mas-dev.csr -subj "/CN=ConfiShare MAS Development"
```

Upload `mas-app.csr` in Apple Developer > Certificates, Identifiers & Profiles > Certificates > **+** > **Mac App Distribution**, then download the `.cer` and build the `.p12`:

```powershell
openssl x509 -inform DER -in mac_app_distribution.cer -out mas-app.crt
openssl pkcs12 -export -legacy -inkey mas-app.key -in mas-app.crt -out mas-app.p12 -name "Mac App Distribution"
openssl x509 -inform DER -in mac_installer_distribution.cer -out mas-installer.crt
openssl pkcs12 -export -legacy -inkey mas-installer.key -in mas-installer.crt -out mas-installer.p12 -name "Mac Installer Distribution"
openssl x509 -inform DER -in apple_development.cer -out mas-dev.crt
openssl pkcs12 -export -legacy -inkey mas-dev.key -in mas-dev.crt -out mas-dev.p12 -name "Apple Development"
```

Repeat with a separate key/CSR for **Mac Installer Distribution** and name it `mas-installer.p12`. For `mas-dev`, use a third key/CSR and an **Apple Development** certificate. OpenSSL 3's `-legacy` creates PKCS#12 files compatible with macOS Security; if your OpenSSL rejects the option, check its version and use its older compatible default. Keep the `.key` files in an encrypted backup; they are the private keys. If `codesign` reports an untrusted chain, install the current Apple WWDR intermediate on the runner rather than weakening signature checks. Check certificate expiry in Apple Developer and renew certificates and profiles before expiry. Reuse an existing valid identity only if you control its matching private key and it belongs to the confirmed team.

Create the provisioning profiles in the Apple Developer portal; no Mac is required to download them.

### Provisioning profiles

Create an explicit App ID profile for `io.confishare.mac`:

- **Mac App Store Connect** distribution profile for the upload package (Apple's current portal label).
  - Linked to the Mac App Distribution certificate.
  - Save locally as `build/embedded.provisionprofile`.
- **Mac App Development** profile for the runnable sandbox test build.
  - Linked to the Apple Development/Mac Developer certificate.
  - Includes the registered UDID of the Mac used for testing. A borrowed/cloud Mac must be registrable for this route; TestFlight is the alternative.
  - Save locally as `build/embedded.dev.provisionprofile`.

Both profile files are git-ignored.

### Team ID

The 10-character Apple Developer Team ID is embedded in the certificate/profile and is needed for App Store Connect and upload automation. Keep it available for the listing and CI configuration.

## 3. App Store Connect items you must provide

Create the app record before uploading:

- Bundle ID: `io.confishare.mac` (or your chosen replacement)
- App name
- SKU (internal, unique)
- Primary language
- Category: Productivity is configured in the build
- Pricing and availability
- Privacy policy URL
- Support URL
- Marketing URL (optional)
- Description, keywords, promotional text
- macOS screenshots
- App icon (the build uses `icon.png`)
- Age rating
- Export compliance/encryption declaration
- Review contact name, email, and phone
- Demo account credentials
- Review notes explaining the DRM/document access flow
- Sample `.cdc` documents and valid access codes that will remain valid during review

The app uses AES-256-GCM and PBKDF2. Complete the export-compliance questions accurately; do not guess.

### Upload credentials

Use one of:

- **CI upload:** the `mas.yml` workflow uploads the validated `.pkg` with an App Store Connect API key when the upload switch is enabled.
- **Transporter** (manual, requires a Mac)
- App Store Connect API key: Issuer ID, Key ID, and `.p8` file

Uploading a build is not the same as submitting it for review. The app record must already exist in App Store Connect for `io.confishare.mac`.

App Store Connect requires a new `CFBundleVersion` for each upload. CI supplies `1.0.(100000 + GitHub run number)` to the MAS builder, increasing on each run of this workflow. `CFBundleShortVersionString` remains the package version (`1.0.2` until the next version change). If you have already uploaded a higher build number for this version, raise the CI offset before the next upload.

## 4. Build and test on macOS

### Install dependencies

```bash
npm ci
```

### Install the profiles

```bash
cp /path/to/MacAppStoreDistribution.provisionprofile build/embedded.provisionprofile
cp /path/to/MacAppDevelopment.provisionprofile build/embedded.dev.provisionprofile
```

### Build a runnable sandbox test app

A distribution-signed Mac App Store `.app` cannot be launched directly on your Mac; Apple re-signs it after App Store installation. Test the same sandboxed code with `mas-dev`:

```bash
CSC_LINK=/path/to/mas-development.p12 \
CSC_KEY_PASSWORD='...' \
npm run build:mas:dev
```

Output:

```text
release-mas/<version>/mas-dev-universal/ConfiShare.app
```

Launch that app and run every item in `docs/MAS_TEST_PLAN.md`.

### Build the App Store upload package

```bash
CSC_LINK=/path/to/mas-distribution.p12 \
CSC_KEY_PASSWORD='...' \
npm run build:mas
```

Output:

```text
release-mas/<version>/mas-universal/ConfiShare-Mac-AppStore-<version>-universal.pkg
```

### Validate the package

```bash
npm run validate:mas
```

The validation script checks:

- universal `x86_64` + `arm64` binary
- strict code signature
- Mac App Distribution identity
- App Sandbox entitlement
- network client entitlement
- user-selected file entitlement
- JIT entitlement
- absence of `get-task-allow`, `disable-library-validation`, and `allow-unsigned-executable-memory`
- embedded provisioning profile and bundle ID
- absence of bundled LibreOffice
- MAS conversion guard in `app.asar`
- `.pkg` signature by Mac Installer Distribution
- `.pkg` payload contains the app and embedded profile

It writes `ConfiShare-mas-validation.txt` next to the package.

Do **not** notarize or staple the MAS `.pkg`. Apple handles that after upload.

## 5. CI workflows

Both workflows are manual (`workflow_dispatch`). The distribution workflow can optionally upload to App Store Connect for TestFlight, but it never submits for review; the dev workflow does not upload.

### Distribution package

`.github/workflows/mas.yml` builds the App Store `.pkg`. Add these repository secrets:

- `MAS_CERTIFICATE_P12_BASE64`: base64 of `mas-app.p12`
- `MAS_CERTIFICATE_PASSWORD`: `mas-app.p12` export password
- `MAS_INSTALLER_CERTIFICATE_P12_BASE64`: base64 of `mas-installer.p12`
- `MAS_INSTALLER_CERTIFICATE_PASSWORD`: `mas-installer.p12` export password
- `MAS_PROVISIONING_PROFILE_BASE64`: base64 of `build/embedded.provisionprofile`

The workflow maps the installer secrets to `CSC_INSTALLER_LINK` and `CSC_INSTALLER_KEY_PASSWORD`.

The workflow writes the profile, runs preflight, builds the signed universal `.pkg`, validates it, and uploads the `.pkg`, validation report, and SHA-256 checksum as an artifact.

To upload the validated package to App Store Connect from CI, use either `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`, and `ASC_API_KEY_P8_BASE64` (base64 of `AuthKey_<KEY_ID>.p8`), or the existing `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD` repository secrets. Create an API key at App Store Connect > Users and Access > Integrations > App Store Connect API if you prefer that method. The key is for upload and is separate from both signing certificates. Download the `.p8` once and keep it encrypted outside git.

Then run the workflow with `upload_to_app_store_connect` enabled. The upload step first runs `xcrun altool --validate-app`, then `--upload-app`, using the API key when configured or the Apple ID credentials otherwise. It uploads only and never submits for review. If the Apple account has multiple teams, verify the upload credentials and signing profile belong to the same intended provider.

The build then appears under App Store Connect > TestFlight processing. Use TestFlight on a cloud Mac to install it and run `docs/MAS_TEST_PLAN.md`.

### Runnable sandbox test app

`.github/workflows/mas-dev.yml` builds a `mas-dev` app that can be launched directly on a Mac. Add these separate secrets:

- `MAS_DEV_CERTIFICATE_P12_BASE64`: base64 of an Apple Development/Mac Developer `.p12`
- `MAS_DEV_CERTIFICATE_PASSWORD`: `.p12` export password
- `MAS_DEV_PROVISIONING_PROFILE_BASE64`: base64 of a Mac App Development profile for `io.confishare.mac`

The workflow writes `build/embedded.dev.provisionprofile`, runs `mas:preflight -- --dev`, builds `mas-dev`, verifies the app/helper signatures and sandbox entitlements, runs a launch/remote-debug smoke test, and uploads a `ConfiShare-mas-dev.zip` artifact plus checksum. The smoke test only proves the app starts; it does not replace the interactive test plan.

### Creating the secret values

On macOS:

```bash
base64 -i /path/to/mas-app.p12 | pbcopy
base64 -i /path/to/mas-installer.p12 | pbcopy
base64 -i /path/to/profile.provisionprofile | pbcopy
base64 -i /path/to/AuthKey_XXXXXXXXXX.p8 | pbcopy
```

On Windows PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\mas-app.p12")) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\mas-installer.p12")) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\profile.provisionprofile")) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\AuthKey_XXXXXXXXXX.p8")) | Set-Clipboard
```

Paste each value into GitHub repository **Settings > Secrets and variables > Actions > New repository secret**. Create the secret with the exact name listed above, paste from the clipboard into **Secret**, and click **Add secret**. Repeat for the two `.p12` passwords as plain secret values and the API key ID/Issuer ID as separate secret values. Never paste keys, passwords, certificates, profiles, or one-time codes into chat. Clear the clipboard afterwards and keep an encrypted offline backup of the keys and `.p12` files.

### Testing without a local Mac

Choose one:

- **Cloud Mac + mas-dev (faster):** Download the `confishare-mas-dev-app` artifact on a cloud Mac, unzip it, and run `xattr -dr com.apple.quarantine /path/to/ConfiShare.app` if Gatekeeper blocks it. Launch the app and run `docs/MAS_TEST_PLAN.md`.
- **Cloud Mac + TestFlight (closest to release):** Upload the distribution `.pkg` to App Store Connect, wait for processing, install the build through TestFlight on the cloud Mac, and run `docs/MAS_TEST_PLAN.md`. This tests the Apple-resigned distribution build.

If you have no macOS environment at all, you cannot complete the GUI test plan. Do not submit for review until a Mac or cloud Mac has run it.

## 6. Entitlements and sandbox behavior

`build/entitlements.mas.plist` contains:

- `com.apple.security.app-sandbox`: required for MAS
- `com.apple.security.cs.allow-jit`: Electron/V8
- `com.apple.security.network.client`: sign-in and document API access to `server.confishare.io`
- `com.apple.security.files.user-selected.read-only`: importing files explicitly chosen by the user

`build/entitlements.mas.inherit.plist` contains:

- `com.apple.security.app-sandbox`
- `com.apple.security.inherit`
- `com.apple.security.cs.allow-jit`

The app does not need camera, microphone, contacts, or full-disk access. Imports use the HTML file picker and copy selected bytes into the app container. The app has no user-facing Save panel and blocks downloads, so read-only selected-file access is the initial entitlement to test. If macOS testing proves a write entitlement is needed for a real feature, update the entitlement and profile together.

Electron 40's MAS signing path uses `@electron/osx-sign` to derive `ElectronTeamID` and the app group `TEAM_ID.<bundle ID>` from the profile. The distribution validation checks both in the signed output. The App ID/profile must authorize that group; if signing reports a restricted-entitlement mismatch, enable App Groups for the App ID and regenerate both profiles. Do not guess a Team ID in the plist.

Electron `safeStorage` uses the macOS Keychain. A sandboxed app can access its own keychain group without an explicit `keychain-access-groups` entitlement. Verify that sign-in/session persistence works in the `mas-dev` build; do not add keychain-sharing entitlements unless the app actually needs to share credentials across bundle IDs.

## 7. LibreOffice audit and limitation

### What the code does today

- `electron/conversion.ts` searches for a bundled `resources/libreoffice/program/soffice`, then system locations, then PATH.
- `electron/documentProcessor.ts` only accepts a bundled `soffice` binary.
- Packaging does not include LibreOffice.
- Native in-app preview supports: DOCX, XLSX, XLS, PPTX, ODT, ODS, ODP, CSV, TSV, TXT, RTF, PDF, and images.
- Legacy binary Office formats `.doc` and `.ppt` require LibreOffice conversion. Legacy `.xls` is handled by SheetJS in the built-in preview.

### MAS behavior

In `mas`/`mas-dev`, `process.mas` is true. Conversion paths for formats that still require LibreOffice (`.doc`, `.ppt`) now throw `MAS_OFFICE_CONVERSION_UNAVAILABLE` instead of trying to launch `soffice`. `DocumentViewer.tsx` turns that into a clear message telling the user to convert to PDF or re-import as a supported format. `.xls` files use the built-in SheetJS preview.

This is the deliberate product limitation for the App Store build.

### Why LibreOffice is not bundled for MAS

- Very large application payload
- LGPL/MPL and bundled third-party licensing obligations
- Nested executables and helper binaries require correct signing and sandbox inheritance
- App Review risk for launching a full office suite from a document viewer
- LibreOffice writes a user profile and expects file-system access that conflicts with a minimal sandbox

If legacy `.doc`/`.ppt` support becomes mandatory, the safer long-term option is server-side conversion, not shipping LibreOffice inside the MAS bundle.

### Capture limitation

The viewer asks Electron to enable `setContentProtection` while a document is open and blocks copy, drag, save, print, and download paths in the UI. Electron documents that newer macOS apps using ScreenCaptureKit can still capture a protected window. Do not promise screenshot-proof viewing in App Store copy or review notes. Test native screenshots and third-party capture separately and describe the actual result.

### DMG behavior

The existing DMG build is unchanged. Legacy `.doc`/`.ppt` conversion still depends on a user-installed LibreOffice or a `soffice` executable on PATH. Modern formats and `.xls` continue to use the built-in preview. Document this limitation in the DMG release notes.

## 8. Submission gate

Do not submit for review until all of the following are true:

- A `mas-dev` or TestFlight distribution build passes `docs/MAS_TEST_PLAN.md` on macOS.
- `npm run validate:mas` passes for the distribution `.pkg`.
- The App Store Connect listing is complete.
- The review demo account and sample documents/access codes work.
- The LibreOffice limitation is accepted and documented.
- The privacy policy and export-compliance answers are complete.
- You have explicitly decided to submit.

## 9. App Store Connect release checklist

In App Store Connect > Apps > your confirmed macOS app, complete the 1.0.2 version page with a factual description of ConfiShare's sign-in, import, protected document viewing, offline authorization window, and document formats. Enter keywords based on the actual product. Do not advertise capture prevention as absolute or promise `.doc`/`.ppt` support in the MAS build. Set Support URL to a working support page and Privacy Policy URL to the actual policy; `https://confishare.io/policy/` is linked in the app but must be checked by the owner before use in the listing.

Under the macOS version's screenshots, capture the running Mac build. Apple currently accepts 16:10 Mac images of 1280×800, 1440×900, 2560×1600, or 2880×1800 pixels, one to ten JPEG/PNG screenshots without transparency. Show the sign-in, document list, protected viewer, and an honest format/permission state using non-sensitive sample documents.

Open **App Privacy** > **Get Started** and declare all data collected by this app, its backend, and any third-party services. Source review shows account email/name, authentication requests, device ID, document activation, and owner audit activity (potentially IP address from server logs). Confirm server retention, analytics, sharing, and linkage with the backend owner before answering the individual privacy questions. Add the actual privacy policy under **App Privacy > Privacy Policy > Edit**.

Complete the app's **Age Rating**, **Content Rights**, **Pricing and Availability**, and any **Business** agreements shown in your account. This app uses AES-256-GCM/PBKDF2 and HTTPS, so answer the encryption/export questions using the actual cryptography and intended countries; do not set `ITSAppUsesNonExemptEncryption` until the owner has determined the correct classification.

On the version page, choose the processed build with the matching bundle ID, version, and run-specific build number. Fill **App Review Information** with a reachable contact and international-format phone number. Provide a working review account and durable sample `.cdc` documents plus valid and revoked/expired code examples through App Store Connect's private review fields, never in git or chat. Review notes should explain the sign-in requirement, activation server, offline window, viewer controls, and unsupported legacy `.doc`/`.ppt` conversion. Choose **Manually release this version** for the first release unless you decide otherwise. Review the complete submission, then request explicit approval before clicking **Add for Review** and **Submit for Review**. After approval, use App Store Connect's manual release control. Future updates require a higher marketing version or new build number, a new signed build, re-testing, updated privacy answers if practices changed, and another review.

## 10. Remaining release gates

The signed universal `.pkg` passed automated validation on a GitHub macOS runner. The remaining checks are:

- Upload the package to App Store Connect and confirm Apple processes it without validation errors.
- Install the processed build through TestFlight on a Mac and complete `docs/MAS_TEST_PLAN.md`, including sign-in, file import, offline access, and Keychain persistence.
- Complete the App Store Connect listing and review information, then submit only after the release is approved.

Mac App Store installation requires a supported macOS version, an Apple Account, and Apple's normal App Store delivery. This build targets macOS 12 or later and contains both Intel and Apple silicon binaries. App Sandbox restrictions are mandatory for Mac App Store apps; the app's file picker and network entitlements are configured for its user flow. The app still requires a ConfiShare account to access its protected-document features.
