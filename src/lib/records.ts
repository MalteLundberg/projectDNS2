export function getEditableRecordName(name: string, zoneName: string) {
  const normalizedZoneName = zoneName.endsWith(".") ? zoneName : `${zoneName}.`;

  if (name === normalizedZoneName) {
    return "@";
  }

  const zoneSuffix = `.${normalizedZoneName}`;

  if (name.endsWith(zoneSuffix)) {
    return name.slice(0, -zoneSuffix.length);
  }

  return name;
}
