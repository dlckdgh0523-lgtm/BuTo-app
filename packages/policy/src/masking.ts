export function maskSensitiveText(input: string): string {
  return input
    .replace(/(?<!\d)01\d[- ]?\d{4}[- ]?\d{4}(?!\d)/g, "[masked-phone]")
    .replace(/(?<!\d)\d{3,4}-\d{4,6}-\d{4,6}(?!\d)/g, "[masked-account]")
    .replace(/(동호수|상세주소|공동현관 비밀번호)/g, "[masked-location-detail]");
}
