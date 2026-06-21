export function getProjectInitials(projectName: string): string {
  return projectName
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3)
}
