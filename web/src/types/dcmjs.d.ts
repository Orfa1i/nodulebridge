// dcmjs ships no type declarations; this covers the small part the privacy code uses.
declare module "dcmjs" {
  export interface DicomElement {
    vr: string;
    Value?: unknown[];
  }
  export type DicomDataset = Record<string, DicomElement>;
  export interface DicomDict {
    meta: DicomDataset;
    dict: DicomDataset;
    write(options?: Record<string, unknown>): ArrayBuffer;
  }
  const dcmjs: {
    data: {
      DicomMessage: { readFile(buffer: ArrayBuffer, options?: Record<string, unknown>): DicomDict };
      DicomDict: new (meta: DicomDataset) => DicomDict;
    };
  };
  export default dcmjs;
}
