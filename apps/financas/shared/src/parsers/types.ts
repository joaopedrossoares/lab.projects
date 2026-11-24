import type { ParsedBillResult } from "../types/domain.js";

export interface PdfTextItemLike {
  str?: string;
  transform: number[];
}

export interface BillParserAdapter {
  readonly id: string;
  readonly name: string;
  parseText(rawText: string): ParsedBillResult;
}
