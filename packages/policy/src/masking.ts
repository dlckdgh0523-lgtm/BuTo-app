export function maskSensitiveText(input: string): string {
  return input
    .replace(/\b01\d[- ]?\d{4}[- ]?\d{4}\b/g, "[masked-phone]")
    .replace(/\b\d{2,3}-\d{2,6}-\d{4,6}\b/g, "[masked-account]")
    .replace(/(동호수|상세주소|공동현관 비밀번호)/g, "[masked-location-detail]");
}

