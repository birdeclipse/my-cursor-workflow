export type EmittedFileKind = "config" | "constraint" | "rtl" | "script" | "report" | "documentation";

export interface EmittedFile {
  fileName: string;
  contents: string;
  adapterId: string;
  kind: EmittedFileKind;
}

export interface EmittedRun {
  runId: string;
  macroName: string;
  macroDir: string;
  files: EmittedFile[];
}
