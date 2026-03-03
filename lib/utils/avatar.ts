/**
 * Generate avatar URL using ui-avatars.com API
 */
export function getAvatarUrl(
  nombre: string,
  apellido: string,
  size: number = 128
): string {
  const name = encodeURIComponent(`${nombre} ${apellido}`);
  return `https://ui-avatars.com/api/?name=${name}&background=0D8ABC&color=fff&size=${size}&bold=true`;
}
