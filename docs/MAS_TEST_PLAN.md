# Mac App Store Test Plan

Use one of these interactive builds:

- `mas-dev` from `.github/workflows/mas-dev.yml` or `npm run build:mas:dev`
  - Download/unzip `ConfiShare-mas-dev.zip` on a Mac.
  - If Gatekeeper blocks it: `xattr -dr com.apple.quarantine /path/to/ConfiShare.app`
  - The CI smoke test only confirms the renderer starts; it is not a substitute for these checks.
- The App Store Connect build installed through TestFlight on a Mac
  - This tests the Apple-resigned distribution build and is the closest to release.

Do not try to launch the distribution `.app` directly; Apple re-signs it after App Store installation. The `mas-dev` build uses the same sandbox entitlements as the distribution build.

## Test data

Prepare:

- Valid test account
- PDF file
- PNG/JPG image
- DOCX
- XLSX
- PPTX
- ODT
- ODS
- ODP
- CSV
- TXT
- RTF
- `.cdc` protected document
- `.zip` containing a `.cdc` document
- Legacy `.doc`
- Legacy `.xls` (should preview natively)
- Legacy `.ppt`
- At least one document with a valid access code
- At least one document with an expired/revoked access code
- A sample file larger than 25 MB, if the product supports it

## 1. Launch and lifecycle

- Launch the app from Finder/Applications.
  - Expected: app opens without a crash; window is usable.
- Close the window with the red button and/or Cmd+W.
  - Expected: app does not crash; no orphan helper processes.
- Click the Dock icon to reopen.
  - Expected: a window is recreated and the app remains usable.
- Quit with Cmd+Q, then relaunch.
  - Expected: app starts cleanly; document list and secure state are loaded.
- Repeat launch/quit three times.
  - Expected: stable behavior, no sandbox-denial crash.

## 2. Sign-in and session persistence

- Sign in online with valid credentials.
  - Expected: success; user session is established.
- Sign out and sign in again.
  - Expected: success.
- Sign in with a wrong password.
  - Expected: clear error; no crash; no unencrypted credentials left on disk.
- Try sign-in with networking disabled.
  - Expected: clear network/offline error, not a hang or crash.
- Sign in, quit the app, relaunch while offline.
  - Expected: the saved session is available through `safeStorage`/Keychain.
- Inspect the app container:
  - `~/Library/Containers/com.confishare.desktop/Data/Library/Application Support/ConfiShare/` (path may vary by Electron userData naming).
  - Expected: no plaintext password/token in `secure_metadata.json`; encrypted values only.

## 3. File import

- Use the import picker and select a PDF.
  - Expected: file is imported and stored under the app container.
- Import DOCX, XLSX, XLS, PPTX, ODT, ODS, ODP, CSV, TXT, RTF, and an image.
  - Expected: all import successfully.
- Import a `.cdc` document.
  - Expected: import succeeds; document appears in the list.
- Import a `.zip` containing a `.cdc` document.
  - Expected: archive is handled as designed; no path traversal or write outside the container.
- Import a document with an access code.
  - Expected: access-code prompt/flow works.
- Import a document with an invalid access code.
  - Expected: clear error; no temporary plaintext left behind.
- Quit and relaunch.
  - Expected: imported documents are still listed and openable.
- Confirm the app cannot read an arbitrary file the user did not select.
  - Expected: sandbox denies it; app reports an error rather than crashing.

## 4. Document viewing

For each imported document, verify the correct viewer:

- PDF
  - Expected: PDF renders in the secure viewer.
- PNG/JPG
  - Expected: image renders; copy/drag is blocked.
- DOCX, XLSX, XLS (legacy binary), PPTX, ODT, ODS, ODP, CSV, TXT, RTF
  - Expected: built-in Office/text preview renders.
- `.cdc` PDF
  - Expected: decrypts and renders as PDF.
- `.cdc` DOCX/XLSX/XLS/PPTX
  - Expected: decrypts and renders with the built-in preview.
- Expired/revoked access code
  - Expected: clear DRM error; no content shown.
- Copy, cut, drag, Cmd+C, Cmd+S, Cmd+P inside the viewer
  - Expected: blocked as designed.
- Navigate back to the document list and open a different document.
  - Expected: previous content is replaced; no stale preview.

## 5. Legacy Office limitation

- Import and open a legacy `.doc` or `.ppt`.
  - Expected: a clear message that legacy Office conversion is unavailable in the Mac App Store build and that the user should convert to PDF or DOCX/XLSX/XLS/PPTX.
  - Expected: no `soffice` process is launched.
  - Expected: no crash and no indefinite spinner.
- Confirm legacy `.xls` previews with the built-in spreadsheet viewer.
- Confirm normal DOCX/XLSX/XLS/PPTX still preview.
- In Activity Monitor, confirm no LibreOffice/soffice process appears during any test.

## 6. Secure storage and Keychain

- Sign in; quit; relaunch.
  - Expected: session restored.
- Open a previously authorized `.cdc` document without re-entering the access code, if the product supports cached authorization.
  - Expected: works through `safeStorage`.
- Inspect Keychain Access for the app's item/access group.
  - Expected: an item is created and readable by the app.
- Move the app container aside or use a fresh test user, then relaunch.
  - Expected: app handles the missing secure state without crashing and asks for sign-in/access code again.

## 7. Network access

- Sign in and activate DRM with networking enabled.
  - Expected: API calls to `server.confishare.io` succeed.
- Open an already authorized document while offline.
  - Expected: offline behavior matches the product design; no crash.
- Try first-time activation while offline.
  - Expected: clear network error.
- Block network access for the app in a test environment, if possible.
  - Expected: clear errors only; no unhandled rejection or renderer crash.

## 8. Sandbox observations

- Confirm the app can read files chosen through the file picker.
- Confirm the app cannot read `/Users/<you>/Documents` or other arbitrary paths without selection.
- Confirm the app writes only inside its container, except user-selected reads.
- Confirm no unhandled sandbox-denial logs cause a crash.
- Confirm helper processes exist and the app functions with sandbox inheritance.

## 9. Package validation

After building the distribution package:

```bash
npm run validate:mas
```

Expected:

- `RESULT: PASSED`
- `.app` is universal (`x86_64` and `arm64`)
- strict signature verification passes
- app identity is Mac App Distribution/Apple Distribution
- sandbox, network client, user-selected file, and JIT entitlements are present
- `get-task-allow`, `disable-library-validation`, and `allow-unsigned-executable-memory` are absent
- embedded provisioning profile exists and matches `com.confishare.desktop`
- no LibreOffice binary is bundled
- `.pkg` is signed by Mac Installer Distribution
- `.pkg` payload contains the app and embedded profile

## 10. Evidence to record

For each test, record:

- macOS version and architecture
- App version and build number
- Tester and date
- Pass/fail
- Screenshot or screen recording for failures
- Relevant Console.app sandbox/Keychain/network errors
- Validation report file

Do not submit for review until every required item passes or the failure is explicitly accepted and documented.
