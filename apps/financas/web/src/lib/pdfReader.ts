import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  groupTextItemsIntoLines,
  itauPdfParser,
  type ParsedBillResult,
  type PdfTextItemLike,
} from "@financas/shared";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function readAndParseItauPdf(file: File): Promise<ParsedBillResult> {
  const buffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({
    data: buffer,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PdfTextItemLike[] = [];

    for (const rawItem of content.items) {
      if ("str" in rawItem && Array.isArray(rawItem.transform)) {
        items.push({ str: rawItem.str, transform: rawItem.transform });
      }
    }

    pages.push(groupTextItemsIntoLines(items));
  }

  return itauPdfParser.parseText(pages.join("\n"));
}
