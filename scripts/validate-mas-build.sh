#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILED=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() {
  echo "PASS: $*"
}

warn() {
  echo "WARN: $*"
}

fail() {
  echo "FAIL: $*"
  FAILED=1
}

APP="${MAS_APP_PATH:-$(find release-mas -type d -path '*/mas*/ConfiShare.app' ! -path '*mas-dev*' 2>/dev/null | sort | tail -n 1)}"
PKG="${MAS_PKG_PATH:-$(find release-mas -type f -name '*.pkg' 2>/dev/null | sort | tail -n 1)}"

if [ -z "${APP:-}" ] || [ ! -d "$APP" ]; then
  echo "FAIL: Could not find the distribution ConfiShare.app under release-mas/."
  echo "      Run npm run build:mas on macOS first, or set MAS_APP_PATH."
  exit 1
fi

REPORT_DIR="$(dirname "$APP")"
if [ -n "${PKG:-}" ] && [ -f "$PKG" ]; then
  REPORT_DIR="$(dirname "$PKG")"
fi
REPORT="$REPORT_DIR/ConfiShare-mas-validation.txt"
mkdir -p "$REPORT_DIR"
exec > >(tee "$REPORT") 2>&1

echo "ConfiShare Mac App Store validation"
echo "App: $APP"
echo "Pkg: ${PKG:-<not found>}"
echo "Date: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
echo

if [ "$(uname -s)" != "Darwin" ]; then
  echo "FAIL: This validation must run on macOS."
  exit 1
fi

echo "== Architecture =="
ARCHS="$(lipo -archs "$APP/Contents/MacOS/ConfiShare" 2>/dev/null || true)"
echo "Architectures: ${ARCHS:-unknown}"
case " $ARCHS " in
  *" x86_64 "*) pass "binary contains x86_64" ;;
  *) fail "binary is missing x86_64" ;;
esac
case " $ARCHS " in
  *" arm64 "*) pass "binary contains arm64" ;;
  *) fail "binary is missing arm64" ;;
esac
echo

echo "== App signature =="
if codesign --verify --deep --strict --verbose=2 "$APP"; then
  pass "strict code signature verification"
else
  fail "strict code signature verification"
fi

codesign -dv --verbose=4 "$APP" > "$TMP/app-signature.txt" 2>&1 || true
cat "$TMP/app-signature.txt"
if grep -Eq '^Authority=(3rd Party Mac Developer Application|Apple Distribution)' "$TMP/app-signature.txt"; then
  pass "app is signed with a Mac App Distribution/Apple Distribution identity"
else
  fail "app is not signed with a Mac App Distribution/Apple Distribution identity"
fi
SIGNING_TEAM="$(sed -n 's/^TeamIdentifier=//p' "$TMP/app-signature.txt" | head -n 1)"
if [ -n "$SIGNING_TEAM" ]; then
  pass "app signature contains a TeamIdentifier"
else
  fail "app signature is missing TeamIdentifier"
fi
echo

echo "== App entitlements =="
if codesign -d --entitlements :- "$APP" > "$TMP/app-entitlements.plist" 2>/dev/null; then
  plutil -convert xml1 "$TMP/app-entitlements.plist" >/dev/null 2>&1 || true
  cat "$TMP/app-entitlements.plist"
else
  fail "could not read app entitlements"
fi

check_true() {
  local key="$1"
  local value
  value="$(/usr/libexec/PlistBuddy -c "Print :$key" "$TMP/app-entitlements.plist" 2>/dev/null || true)"
  if [ "$value" = "true" ]; then
    pass "entitlement $key=true"
  else
    fail "entitlement $key is missing or not true (value: ${value:-missing})"
  fi
}

check_absent() {
  local key="$1"
  local value
  value="$(/usr/libexec/PlistBuddy -c "Print :$key" "$TMP/app-entitlements.plist" 2>/dev/null || true)"
  if [ -z "$value" ] || [ "$value" = "false" ]; then
    pass "entitlement $key is absent/false"
  else
    fail "entitlement $key must not be enabled for MAS (value: $value)"
  fi
}

check_value() {
  local key="$1"
  local expected="$2"
  local value
  value="$(/usr/libexec/PlistBuddy -c "Print :$key" "$TMP/app-entitlements.plist" 2>/dev/null || true)"
  case "$value" in
    *"$expected"*) pass "entitlement $key contains $expected" ;;
    *) fail "entitlement $key does not contain $expected (value: ${value:-missing})" ;;
  esac
}

check_true "com.apple.security.app-sandbox"
check_true "com.apple.security.cs.allow-jit"
check_true "com.apple.security.network.client"
if /usr/libexec/PlistBuddy -c "Print :com.apple.security.files.user-selected.read-only" "$TMP/app-entitlements.plist" 2>/dev/null | grep -q true; then
  pass "entitlement com.apple.security.files.user-selected.read-only=true"
elif /usr/libexec/PlistBuddy -c "Print :com.apple.security.files.user-selected.read-write" "$TMP/app-entitlements.plist" 2>/dev/null | grep -q true; then
  pass "entitlement com.apple.security.files.user-selected.read-write=true"
else
  fail "no user-selected file entitlement is enabled"
fi
check_value "com.apple.application-identifier" "io.confishare.mac"
TEAM_IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.team-identifier' "$TMP/app-entitlements.plist" 2>/dev/null || true)"
if [ -n "$TEAM_IDENTIFIER" ]; then
  pass "entitlement com.apple.developer.team-identifier=$TEAM_IDENTIFIER"
  if [ -n "$SIGNING_TEAM" ] && [ "$TEAM_IDENTIFIER" != "$SIGNING_TEAM" ]; then
    fail "app entitlement team $TEAM_IDENTIFIER differs from signature team $SIGNING_TEAM"
  fi
else
  fail "entitlement com.apple.developer.team-identifier is missing"
fi
check_value "com.apple.security.application-groups" "$SIGNING_TEAM.io.confishare.mac"
check_absent "com.apple.security.get-task-allow"
check_absent "com.apple.security.cs.disable-library-validation"
check_absent "com.apple.security.cs.allow-unsigned-executable-memory"
echo

echo "== Helper sandbox entitlements =="
HELPER_COUNT=0
for HELPER in "$APP/Contents/Frameworks/"*.app; do
  [ -d "$HELPER" ] || continue
  HELPER_COUNT=$((HELPER_COUNT + 1))
  if codesign -d --entitlements :- "$HELPER" > "$TMP/helper-entitlements.plist" 2>/dev/null; then
    plutil -convert xml1 "$TMP/helper-entitlements.plist" >/dev/null 2>&1 || true
    HELPER_SANDBOX="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.security.app-sandbox' "$TMP/helper-entitlements.plist" 2>/dev/null || true)"
    HELPER_INHERIT="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.security.inherit' "$TMP/helper-entitlements.plist" 2>/dev/null || true)"
    HELPER_GET_TASK="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.security.get-task-allow' "$TMP/helper-entitlements.plist" 2>/dev/null || true)"
    if [ "$HELPER_GET_TASK" = "true" ]; then
      fail "helper $(basename "$HELPER") has get-task-allow=true; distribution helpers must not be debuggable"
    fi
    if [ "$HELPER_SANDBOX" = "true" ]; then
      pass "helper $(basename "$HELPER") has app-sandbox=true"
    else
      fail "helper $(basename "$HELPER") is missing app-sandbox=true"
    fi
    if [ "$HELPER_INHERIT" = "true" ]; then
      pass "helper $(basename "$HELPER") has inherit=true"
    else
      fail "helper $(basename "$HELPER") is missing inherit=true"
    fi
  else
    fail "could not read entitlements for helper $(basename "$HELPER")"
  fi
done
if [ "$HELPER_COUNT" -eq 0 ]; then
  warn "no helper .app bundles found under Contents/Frameworks"
fi
echo

echo "== Embedded provisioning profile =="
PROFILE="$APP/Contents/embedded.provisionprofile"
if [ -f "$PROFILE" ]; then
  pass "Contents/embedded.provisionprofile exists"
  if security cms -D -i "$PROFILE" > "$TMP/profile.plist" 2>/dev/null; then
    PROFILE_APP_ID="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.application-identifier' "$TMP/profile.plist" 2>/dev/null || true)"
    case "$PROFILE_APP_ID" in
      *.io.confishare.mac) pass "profile application identifier: $PROFILE_APP_ID" ;;
      *) fail "profile application identifier does not end in .io.confishare.mac (value: ${PROFILE_APP_ID:-missing})" ;;
    esac
    PROFILE_TEAM="${PROFILE_APP_ID%.io.confishare.mac}"
    if [ -n "$SIGNING_TEAM" ] && [ "$PROFILE_TEAM" != "$SIGNING_TEAM" ]; then
      fail "provisioning profile team $PROFILE_TEAM differs from signature team $SIGNING_TEAM"
    fi
    PROFILE_EXPIRATION="$(/usr/libexec/PlistBuddy -c 'Print :ExpirationDate' "$TMP/profile.plist" 2>/dev/null || true)"
    if [ -n "$PROFILE_EXPIRATION" ]; then
      pass "profile expiration: $PROFILE_EXPIRATION"
    else
      warn "could not read profile expiration date"
    fi
    PROFILE_GET_TASK="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:get-task-allow' "$TMP/profile.plist" 2>/dev/null || true)"
    if [ "$PROFILE_GET_TASK" = "true" ]; then
      fail "distribution profile has get-task-allow=true"
    else
      pass "profile does not allow get-task-allow"
    fi
  else
    fail "could not decode embedded.provisionprofile"
  fi
else
  fail "Contents/embedded.provisionprofile is missing"
fi
echo

echo "== Bundle metadata =="
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist" 2>/dev/null || true)"
ELECTRON_TEAM_ID="$(/usr/libexec/PlistBuddy -c 'Print :ElectronTeamID' "$APP/Contents/Info.plist" 2>/dev/null || true)"
BUNDLE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || true)"
BUILD_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist" 2>/dev/null || true)"
echo "CFBundleIdentifier: ${BUNDLE_ID:-missing}"
echo "CFBundleShortVersionString: ${BUNDLE_VERSION:-missing}"
echo "CFBundleVersion: ${BUILD_VERSION:-missing}"
if [ "$BUNDLE_ID" = "io.confishare.mac" ]; then
  pass "bundle identifier is io.confishare.mac"
else
  fail "unexpected bundle identifier: ${BUNDLE_ID:-missing}"
fi
if [ -n "$SIGNING_TEAM" ] && [ "$ELECTRON_TEAM_ID" = "$SIGNING_TEAM" ]; then
  pass "ElectronTeamID matches signing team"
else
  fail "ElectronTeamID ${ELECTRON_TEAM_ID:-missing} does not match signing team ${SIGNING_TEAM:-missing}"
fi
if [ -n "$BUNDLE_VERSION" ]; then
  pass "bundle version is set"
else
  fail "bundle version is missing"
fi
if [ -n "${MAS_EXPECTED_BUILD_VERSION:-}" ]; then
  if [ "$BUILD_VERSION" = "$MAS_EXPECTED_BUILD_VERSION" ]; then
    pass "CFBundleVersion matches CI build number $MAS_EXPECTED_BUILD_VERSION"
  else
    fail "CFBundleVersion $BUILD_VERSION does not match expected $MAS_EXPECTED_BUILD_VERSION"
  fi
fi
echo

echo "== MAS conversion guard =="
if [ -f "$APP/Contents/Resources/app.asar" ] && grep -aq 'MAS_OFFICE_CONVERSION_UNAVAILABLE' "$APP/Contents/Resources/app.asar"; then
  pass "bundled app contains the MAS Office conversion guard"
else
  warn "could not confirm the MAS Office conversion guard in app.asar"
fi
if find "$APP" -iname 'soffice*' -print -quit 2>/dev/null | grep -q .; then
  fail "LibreOffice/soffice is bundled in the app; the MAS build must not execute it"
else
  pass "no LibreOffice/soffice binary is bundled"
fi
echo

echo "== Installer package =="
if [ -n "${PKG:-}" ] && [ -f "$PKG" ]; then
  if pkgutil --check-signature "$PKG" > "$TMP/pkg-signature.txt" 2>&1; then
    cat "$TMP/pkg-signature.txt"
    if grep -Eq '3rd Party Mac Developer Installer|Mac Installer Distribution' "$TMP/pkg-signature.txt"; then
      pass "pkg is signed with the Mac Installer Distribution identity"
    else
      fail "pkg is not signed with the Mac Installer Distribution identity"
    fi
  else
    cat "$TMP/pkg-signature.txt" || true
    fail "pkg signature check failed"
  fi

  if pkgutil --payload-files "$PKG" 2>/dev/null | grep -q 'embedded.provisionprofile'; then
    pass "pkg payload contains the embedded provisioning profile"
  else
    fail "pkg payload does not contain the embedded provisioning profile"
  fi
  if pkgutil --payload-files "$PKG" 2>/dev/null | grep -q 'Contents/MacOS/ConfiShare'; then
    pass "pkg payload contains the ConfiShare app binary"
  else
    fail "pkg payload does not contain the ConfiShare app binary"
  fi
else
  warn "No .pkg found; app-only validation completed. Build the distribution target to produce an upload package."
fi
echo

echo "== Notes =="
echo "Do not notarize or staple a Mac App Store .pkg. Apple processes it after upload."
echo "Do not launch the distribution-signed .app directly; test the mas-dev build instead."
echo "Upload with Transporter or: xcrun altool --upload-app --type macos -f <pkg> ..."
echo "Submission for review is intentionally not automated."
echo

if [ "$FAILED" -ne 0 ]; then
  echo "RESULT: FAILED"
  exit 1
fi

echo "RESULT: PASSED"
echo "Report: $REPORT"
