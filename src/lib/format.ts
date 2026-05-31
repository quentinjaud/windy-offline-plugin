export function formatDate(dateOrIso: Date | string): string {
    const date = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}
