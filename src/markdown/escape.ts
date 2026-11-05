/** Escape literal text without turning entity syntax, HTML or tilde fences into markdown nodes. */
export function escapeMarkdownText(text: string): string {
  return text
    .replace(/[\\*_`[\]~<]/g, '\\$&')
    .replace(/&(?=(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);)/gi, '\\&')
    .replace(/\b(https?)(?=:\/\/)/gi, '$1\\')
    .replace(/\bwww\./gi, 'www\\.')
    .replace(/@(?=[a-z\d][\w.-]*\.[a-z]{2,}\b)/gi, '\\@');
}
