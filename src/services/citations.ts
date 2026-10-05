/**
 * Removes citations a model invented: the literal "[n]", numbers that don't
 * match a retrieved source, and a trailing "References:"/"Sources:" list
 * (the app shows the real sources under each answer). Display only; the
 * stored message keeps the model's text as generated.
 *
 * `sourceCount` is how many sources were retrieved for this answer, or
 * undefined when unknown (e.g. a reopened chat), in which case numbered
 * citations are left alone.
 */
export function cleanCitations(text: string, sourceCount: number | undefined): string {
  let out = text;

  // A trailing reference list: a "References:"/"Sources:" line and everything after it.
  const list = /\n[ \t]*(?:\*\*|__)?(?:references?|sources?)(?:\*\*|__)?[ \t]*:(?:\*\*|__)?[^\n]*(?:\n[\s\S]*)?$/i.exec(out);
  if (list && list.index > 0) out = out.slice(0, list.index);

  out = out.replace(/[ \t]*\[n\]/gi, "");
  if (sourceCount !== undefined) {
    out = out.replace(/[ \t]*\[(\d+)\]/g, (match, n) => {
      const i = Number(n);
      return i >= 1 && i <= sourceCount ? match : "";
    });
  }

  // Tidy what the removals leave behind: "text ." -> "text.", ", ," -> ",".
  return out
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/([,;])(\s*[,;])+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
