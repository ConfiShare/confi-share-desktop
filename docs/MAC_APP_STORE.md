# Mac App Store Build and Submission Guide

## Current status

The repository now has a separate Mac App Store build path:

- `electron-builder-mas.json5` builds a sandboxed `mas` package and a runnable `mas-dev` test build.
- `build/entitlements.mas.plist` and `build/entitlements.mas.inherit.plist` provide App Sandbox entitlements.
- MAS builds no longer execute LibreOffice; legacy `.doc`/`.ppt` conversion reports an explicit limitation, while legacy `.xls` previews natively via SheetJS.
- `scripts/mas-preflight.mjs` checks the profile, entitlements, and signing identities before a build.
- `scripts/validate-mas-build.sh` validates the produced `.app`/`.pkg` on macOS.
- `.github/workflows/mas.yml` is a manual, build-and-validate-only workflow.
- `docs/MAS_TEST_PLAN.md` is the required macOS test checklist.

This has **not** been built, signed, or tested on macOS from this Windows workspace. It also has **not** been uploaded to App Store Connect or submitted for review. Those steps require your Apple account, certificates, provisioning profiles, and a Mac (or the macOS GitHub runner).

## Keep the two release paths separate

| Path | Config | Signing | Output |
| --- | --- | --- | --- |
| GitHub DMG releases | `electron-builder.json5` | Developer ID Application + notarization | signed/notarized DMG |
| Mac App Store | `electron-builder-mas.json5` | Mac App Distribution + Mac Installer Distribution | `.pkg` for App Store Connect |

Do not reuse the Developer ID certificate, notarization credentials, or `dmg` settings for MAS. The MAS config intentionally sets `notarize: false`, does not configure `dmg`, and uses separate entitlements.

## 1. Verify the bundle ID

The configured bundle ID is `com.confishare.desktop`.

Check both places:

1. Apple Developer > Certificates, Identifiers & Profiles > Identifiers.
2. App Store Connect > Apps.

An explicit App ID is required for a Mac App Store provisioning profile. The same bundle ID can be used by both the Developer ID DMG and the Mac App Store build. If `com.confishare.desktop` is not registered or is already owned by another App Store record, choose an available ID and update:

- `electron-builder-mas.json5`: `appId`, `mas.appId`, `masDev.appId`, `helperBundleId`
- the provisioning profile
- the App Store Connect app record

Bundle ID availability cannot be checked from this workspace.

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

electron-builder accepts the app identity through `CSC_LINK` and the installer identity through `CSC_INSTALLER_LINK`. A single combined `.p12` also works if you set only `CSC_LINK`, but two files are easier to create without a Mac.

Keep the Developer ID certificates out of these `.p12` files so the App Store build and DMG release credentials remain separate.

#### Creating certificates without a Mac

You can create the CSR and `.p12` on Windows with OpenSSL (included with Git for Windows):

```powershell
openssl req -new -newkey rsa:2048 -nodes -keyout mas-app.key -out mas-app.csr -subj "/CN=ConfiShare MAS App"
```

Upload `mas-app.csr` in Apple Developer > Certificates, Identifiers & Profiles > Certificates > **+** > **Mac App Distribution**, then download the `.cer` and build the `.p12`:

```powershell
openssl x509 -inform DER -in mac_app_distribution.cer -out mas-app.crt
openssl pkcs12 -export -inkey mas-app.key -in mas-app.crt -out mas-app.p12 -name "Mac App Distribution"
```

Repeat with a second key/CSR for **Mac Installer Distribution** and name it `mas-installer.p12`. Keep the `.key` files safe; they are the private keys. If `codesign` reports an untrusted chain, include the Apple WWDR intermediate certificate with `-certfile`.

Create the provisioning profiles in the Apple Developer portal; no Mac is required to download them.

### Provisioning profiles

Create an explicit App ID profile for `com.confishare.desktop`:

- **Mac App Store** distribution profile for the upload package.
  - Linked to the Mac App Distribution certificate.
  - Save locally as `build/embedded.provisionprofile`.
- **Mac App Development** profile for the runnable sandbox test build.
  - Linked to the Apple Development/Mac Developer certificate.
  - Save locally as `build/embedded.dev.provisionprofile`.

Both profile files are git-ignored.

### Team ID

The 10-character Apple Developer Team ID is embedded in the certificate/profile and is needed for App Store Connect and upload automation. Keep it available for the listing and CI configuration.

## 3. App Store Connect items you must provide

Create the app record before uploading:

- Bundle ID: `com.confishare.desktop` (or your chosen replacement)
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

- **CI upload (best when you have no Mac):** the `mas.yml` workflow can upload the validated `.pkg` with your existing `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` repository secrets, or with an App Store Connect API key.
- **Transporter** (manual, requires a Mac)
- App Store Connect API key: Issuer ID, Key ID, and `.p8` file
- Apple ID + app-specific password with `xcrun altool --upload-app` (legacy)

Uploading a build is not the same as submitting it for review. The app record must already exist in App Store Connect for `com.confishare.desktop`.

App Store Connect requires a unique `CFBundleVersion` for each upload. The build currently derives it from `package.json` version (`1.0.2`). Bump the version or set `mac.bundleVersion` before rebuilding if that build number has already been used.

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
- `MAS_INSTALLER_CERTIFICATE_P12_BASE64`: base64 of `mas-installer.p12` (optional if combined into the app `.p12` or already in the keychain)
- `MAS_INSTALLER_CERTIFICATE_PASSWORD`: `mas-installer.p12` export password
- `MAS_PROVISIONING_PROFILE_BASE64`: base64 of `build/embedded.provisionprofile`

The workflow maps the installer secrets to `CSC_INSTALLER_LINK` and `CSC_INSTALLER_KEY_PASSWORD` when present.

The workflow writes the profile, runs preflight, builds the signed universal `.pkg`, validates it, and uploads the `.pkg`, validation report, and SHA-256 checksum as an artifact.

To upload the validated package to App Store Connect from CI, use either:

- The existing `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` repository secrets (already used by the DMG notarization workflow), or
- `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`, and `ASC_API_KEY_P8_BASE64` (base64 of `AuthKey_<KEY_ID>.p8`). The API key needs the **App Manager** or **Admin** role.

Then run the workflow with `upload_to_app_store_connect` enabled. The upload step uses `xcrun altool --upload-app -t macos`; it uploads only and never submits for review. If your local `altool` is older and rejects `macos`, use `-t osx` manually.

The build then appears under App Store Connect > TestFlight processing. Use TestFlight on a cloud Mac to install it and run `docs/MAS_TEST_PLAN.md`.

### Runnable sandbox test app

`.github/workflows/mas-dev.yml` builds a `mas-dev` app that can be launched directly on a Mac. Add these separate secrets:

- `MAS_DEV_CERTIFICATE_P12_BASE64`: base64 of an Apple Development/Mac Developer `.p12`
- `MAS_DEV_CERTIFICATE_PASSWORD`: `.p12` export password
- `MAS_DEV_PROVISIONING_PROFILE_BASE64`: base64 of a Mac App Development profile for `com.confishare.desktop`

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

Paste each value into GitHub under **Settings > Secrets and variables > Actions**.

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

The app does not need camera, microphone, contacts, or full-disk access. If macOS testing shows the file picker needs write access, switch the user-selected entitlement to read-write and update `scripts/mas-preflight.mjs` and `scripts/validate-mas-build.sh` accordingly.

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

## 9. Blockers in this workspace

This workspace is Windows and has no Apple signing material. It cannot:

- run `npm run build:mas` (requires macOS)
- sign, package, or validate the `.pkg`
- launch the `mas-dev` build
- verify the bundle ID in your Apple account
- upload to App Store Connect
- complete or submit the App Store listing

Provide the items in sections 2 and 3, run the macOS steps above, and share the validation report plus test-plan results for review.
