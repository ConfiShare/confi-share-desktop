/**
 * True only when Electron is running from a Mac App Store (mas or mas-dev)
 * build. The Mac App Store build must not execute external conversion tools.
 */
export function isMacAppStoreBuild(): boolean {
  return process.mas === true;
}

export const MAS_OFFICE_CONVERSION_UNAVAILABLE = 'MAS_OFFICE_CONVERSION_UNAVAILABLE';

export const MAS_OFFICE_CONVERSION_MESSAGE =
  'Office-to-PDF conversion is unavailable in the Mac App Store build. ' +
  'This build previews DOCX, XLSX, PPTX, ODT, ODS, ODP, CSV, TSV, TXT, RTF, PDF, and image files in-app. ' +
  'Legacy .doc and .ppt files are not supported in the App Store build; .xls uses the built-in preview.';

export function createMasOfficeConversionError(): Error {
  return new Error(`${MAS_OFFICE_CONVERSION_UNAVAILABLE}: ${MAS_OFFICE_CONVERSION_MESSAGE}`);
}
